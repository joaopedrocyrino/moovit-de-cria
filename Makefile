.PHONY: dev build test data up refresh down
dev:
	npm run dev
build:
	npm run build
test:
	npm test
data:
	npm run data:sync
up:
	docker compose up -d --build app
refresh:
	docker compose up -d --build app
down:
	docker compose down
