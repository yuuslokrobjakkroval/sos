import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";

export function AppIcon({
  icon,
  size = 18,
  className,
}: {
  icon: IconSvgElement;
  size?: number;
  className?: string;
}) {
  return (
    <HugeiconsIcon
      icon={icon}
      size={size}
      strokeWidth={1.75}
      className={className}
      aria-hidden
    />
  );
}
