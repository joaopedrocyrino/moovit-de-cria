import { useRef, useState, type PointerEvent, type ReactNode } from "react";
import "./BottomSheet.css";

type Props = {
  mobile: boolean;
  expanded: boolean;
  onChange: (open: boolean) => void;
  children: ReactNode;
};
export default function BottomSheet({
  mobile,
  expanded,
  onChange,
  children,
}: Props) {
  const [offset, setOffset] = useState(0);
  const start = useRef<number | null>(null),
    moved = useRef(false);
  const content = useRef<HTMLDivElement>(null);
  function change(open: boolean) {
    if (!open) {
      if (
        document.activeElement instanceof HTMLElement &&
        content.current?.contains(document.activeElement)
      )
        document.activeElement.blur();
      if (content.current) content.current.scrollTop = 0;
    }
    onChange(open);
  }
  function down(event: PointerEvent<HTMLButtonElement>) {
    start.current = event.clientY;
    moved.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function move(event: PointerEvent<HTMLButtonElement>) {
    if (start.current === null) return;
    const distance = event.clientY - start.current;
    if (Math.abs(distance) > 5) moved.current = true;
    setOffset(
      expanded
        ? Math.max(0, Math.min(distance, 240))
        : Math.min(0, Math.max(distance, -180)),
    );
  }
  function up(event: PointerEvent<HTMLButtonElement>) {
    if (start.current !== null) {
      const distance = event.clientY - start.current;
      if (expanded && distance > 65) change(false);
      else if (!expanded && distance < -45) change(true);
    }
    start.current = null;
    setOffset(0);
  }
  return (
    <section
      className={`bottom-sheet ${mobile && !expanded ? "collapsed" : "expanded"}${offset ? " dragging" : ""}`}
      style={mobile ? { transform: `translateY(${offset}px)` } : undefined}
      aria-label="Planejamento e acompanhamento da viagem"
    >
      {mobile && (
        <button
          className="sheet-handle"
          aria-label={expanded ? "Recolher detalhes" : "Abrir detalhes"}
          aria-expanded={expanded}
          aria-controls="trip-panel-content"
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={() => {
            start.current = null;
            setOffset(0);
          }}
          onClick={() => {
            if (!moved.current) change(!expanded);
            moved.current = false;
          }}
        >
          <span />
        </button>
      )}
      <div className="panel-scroll" id="trip-panel-content" ref={content}>
        {children}
      </div>
    </section>
  );
}
