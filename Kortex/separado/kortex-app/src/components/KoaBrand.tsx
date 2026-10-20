export const KOA_BRAND_ASSET = "/brand/koa-minimized-robot.png";

export default function KoaBrand({
  size = 24,
  className = "",
  label,
  processing = false,
}: {
  size?: number | string;
  strokeWidth?: number;
  className?: string;
  label?: string;
  processing?: boolean;
}) {
  return (
    <span
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={`koa-brand koa-symbol-motion ${processing ? "koa-brand--processing" : ""} ${className}`}
      style={{
        width: size,
        height: size,
        display: "inline-block",
        position: "relative",
        flexShrink: 0,
      }}
    >
      <img
        src={KOA_BRAND_ASSET}
        alt=""
        aria-hidden="true"
        style={{
          position: "absolute",
          width: "135%",
          height: "135%",
          maxWidth: "none",
          left: "-17.5%",
          top: "-17.5%",
          objectFit: "contain",
        }}
      />
    </span>
  );
}
