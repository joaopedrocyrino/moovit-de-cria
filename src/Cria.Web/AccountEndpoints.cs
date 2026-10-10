using System.Security.Claims;
using Cria.Application;
using Cria.Domain;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Mvc;

namespace Cria.Web;

public static class AccountEndpoints
{
    public static void AddAccounts(this WebApplicationBuilder builder)
    {
        var keys = Path.GetFullPath(builder.Configuration["Accounts:Keys"] ?? ".data/accounts/keys");
        Directory.CreateDirectory(keys);
        if (!OperatingSystem.IsWindows()) File.SetUnixFileMode(keys, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
        builder.Services.AddDataProtection().SetApplicationName("MoovitDeCria.Accounts").PersistKeysToFileSystem(new DirectoryInfo(keys));
        builder.Services.AddSingleton(TimeProvider.System);
        builder.Services.AddSingleton<Cria.Infrastructure.ApplicationDatabase>();
        builder.Services.AddSingleton<IAccounts, Cria.Infrastructure.Accounts>();
        builder.Services.AddSingleton<LineCatalog>();
        var secure = !builder.Environment.IsDevelopment();
        builder.Services.AddAntiforgery(options =>
        {
            options.HeaderName = "X-CSRF-Token";
            options.Cookie.Name = secure ? "__Host-cria-csrf" : "cria-csrf";
            options.Cookie.Path = "/";
            options.Cookie.HttpOnly = true;
            options.Cookie.SameSite = SameSiteMode.Lax;
            options.Cookie.SecurePolicy = secure ? CookieSecurePolicy.Always : CookieSecurePolicy.SameAsRequest;
        });
        builder.Services.AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme).AddCookie(options =>
        {
            options.Cookie.Name = secure ? "__Host-cria-session" : "cria-session";
            options.Cookie.Path = "/";
            options.Cookie.HttpOnly = true;
            options.Cookie.SameSite = SameSiteMode.Lax;
            options.Cookie.SecurePolicy = secure ? CookieSecurePolicy.Always : CookieSecurePolicy.SameAsRequest;
            options.ExpireTimeSpan = TimeSpan.FromDays(14);
            options.SlidingExpiration = false;
            options.Events.OnRedirectToLogin = context => { context.Response.StatusCode = 401; return Task.CompletedTask; };
            options.Events.OnRedirectToAccessDenied = context => { context.Response.StatusCode = 403; return Task.CompletedTask; };
            options.Events.OnValidatePrincipal = async context =>
            {
                var id = context.Principal?.FindFirstValue(ClaimTypes.NameIdentifier);
                var session = context.Principal?.FindFirstValue("session");
                if (id is null || session is null || context.HttpContext.RequestServices.GetRequiredService<IAccounts>().ValidateSession(session, id) is null)
                {
                    context.RejectPrincipal();
                    await context.HttpContext.SignOutAsync();
                }
            };
        });
        builder.Services.AddAuthorization();
        builder.WebHost.ConfigureKestrel(options => options.Limits.MaxRequestBodySize = 64 * 1024);
    }

    public static void MapAccounts(this WebApplication app)
    {
        // Fail startup on an unreadable/unmigrated account store rather than silently losing saved data.
        app.Services.GetRequiredService<IAccounts>();
        var auth = app.MapGroup("/api/auth").AddEndpointFilter<CsrfFilter>();
        auth.MapGet("/session", Session);
        auth.MapPost("/register", async (RegisterInput input, IAccounts accounts, HttpContext context, IAntiforgery csrf) =>
            await SignIn(context, accounts, csrf, accounts.Register(input.Name, input.Email, input.Password))).RequireRateLimiting("account-auth");
        auth.MapPost("/login", async (LoginInput input, IAccounts accounts, HttpContext context, IAntiforgery csrf) =>
            await SignIn(context, accounts, csrf, accounts.Login(input.Email, input.Password))).RequireRateLimiting("account-auth");
        auth.MapPost("/logout", async (IAccounts accounts, HttpContext context, IAntiforgery csrf) =>
        {
            if (context.User.FindFirstValue("session") is { } session) accounts.RevokeSession(session);
            await context.SignOutAsync();
            context.User = new ClaimsPrincipal(new ClaimsIdentity());
            return Session(context, csrf);
        });

        app.MapGet("/api/lines", (string? query, LineCatalog catalog) => catalog.Search(query));
        var account = app.MapGroup("/api/account").RequireAuthorization().AddEndpointFilter<CsrfFilter>();
        account.MapGet("/saved", (HttpContext context, IAccounts accounts) => accounts.GetData(UserId(context)));
        account.MapPost("/addresses", (AddressInput input, HttpContext context, IAccounts accounts) =>
            accounts.SaveAddress(UserId(context), null, input.Alias, input.Address, input.Point));
        account.MapPut("/addresses/{id}", (string id, AddressInput input, HttpContext context, IAccounts accounts) =>
            accounts.SaveAddress(UserId(context), id, input.Alias, input.Address, input.Point));
        account.MapDelete("/addresses/{id}", (string id, HttpContext context, IAccounts accounts) =>
        {
            accounts.DeleteAddress(UserId(context), id);
            return Results.NoContent();
        });
        account.MapPost("/lines", (LineInput input, HttpContext context, IAccounts accounts, LineCatalog catalog) =>
            accounts.SaveLine(UserId(context), catalog.Find(input.Mode, input.Line)));
        account.MapDelete("/lines/{id}", (string id, HttpContext context, IAccounts accounts) =>
        {
            accounts.DeleteLine(UserId(context), id);
            return Results.NoContent();
        });
        account.MapPost("/password", async (PasswordInput input, HttpContext context, IAccounts accounts, IAntiforgery csrf) =>
        {
            var user = CurrentUser(context)!;
            accounts.ChangePassword(user.Id, input.Password, input.NewPassword);
            return await SignIn(context, accounts, csrf, user);
        }).RequireRateLimiting("account-auth");
        account.MapDelete("", async ([FromBody] DeleteInput input, HttpContext context, IAccounts accounts, IAntiforgery csrf) =>
        {
            accounts.DeleteAccount(UserId(context), input.Password);
            await context.SignOutAsync();
            context.User = new ClaimsPrincipal(new ClaimsIdentity());
            return Session(context, csrf);
        }).RequireRateLimiting("account-auth");
    }

    private static string UserId(HttpContext context) => context.User.FindFirstValue(ClaimTypes.NameIdentifier) ?? throw new AppError(401, "Entre na sua conta.");
    private static AccountUser? CurrentUser(HttpContext context) => context.User.Identity?.IsAuthenticated == true
        ? new(UserId(context), context.User.FindFirstValue(ClaimTypes.Name) ?? "", context.User.FindFirstValue(ClaimTypes.Email) ?? "") : null;
    private static IResult Session(HttpContext context, IAntiforgery csrf) => Results.Ok(new { user = CurrentUser(context), csrfToken = csrf.GetAndStoreTokens(context).RequestToken });
    private static async Task<IResult> SignIn(HttpContext context, IAccounts accounts, IAntiforgery csrf, AccountUser user)
    {
        var expires = DateTimeOffset.UtcNow.AddDays(14);
        var session = accounts.CreateSession(user.Id, expires);
        var identity = new ClaimsIdentity([
            new(ClaimTypes.NameIdentifier, user.Id), new(ClaimTypes.Name, user.Name), new(ClaimTypes.Email, user.Email), new("session", session)
        ], CookieAuthenticationDefaults.AuthenticationScheme);
        context.User = new ClaimsPrincipal(identity);
        await context.SignInAsync(context.User, new AuthenticationProperties { IsPersistent = true, ExpiresUtc = expires });
        return Session(context, csrf);
    }

    public sealed class CsrfFilter(IAntiforgery csrf) : IEndpointFilter
    {
        public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
        {
            if (!HttpMethods.IsGet(context.HttpContext.Request.Method))
            {
                try { await csrf.ValidateRequestAsync(context.HttpContext); }
                catch (AntiforgeryValidationException) { throw new AppError(403, "Sua sessão mudou. Atualize a página e tente novamente."); }
            }
            return await next(context);
        }
    }

    private sealed record RegisterInput(string Name, string Email, string Password);
    private sealed record LoginInput(string Email, string Password);
    private sealed record AddressInput(string Alias, string Address, Point Point);
    private sealed record LineInput(string Mode, string Line);
    private sealed record PasswordInput(string Password, string NewPassword);
    private sealed record DeleteInput(string Password);
}
