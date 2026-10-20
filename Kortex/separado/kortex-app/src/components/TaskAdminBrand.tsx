export const TASK_ADMIN_BRAND_ASSET = "/brand/koa-assistant.png";

/** Identity of task administration, separate from the operational KOA. */
export default function TaskAdminBrand({
  size = 24,
  className = "",
  label,
}: {
  size?: number | string;
  strokeWidth?: number;
  className?: string;
  label?: string;
}) {
  return (
    <img
      src={TASK_ADMIN_BRAND_ASSET}
      alt={label ?? ""}
      aria-hidden={label ? undefined : true}
      className={`task-admin-brand ${className}`}
      style={{ width: size, height: size, objectFit: "contain", flexShrink: 0 }}
    />
  );
}
