import { useState } from "react";

const MASCOT_IMAGES = [
  "/mascots/mascot-1.png",
  "/mascots/mascot-2.png",
  "/mascots/mascot-3.png",
];

/** 项目彩蛋吉祥物：每次挂载随机换一位，出现在登录页角落/空状态/关于页。 */
export default function Mascot({
  className = "",
  size = 56,
  alt = "",
}: {
  className?: string;
  size?: number;
  alt?: string;
}) {
  const [src] = useState(
    () => MASCOT_IMAGES[Math.floor(Math.random() * MASCOT_IMAGES.length)],
  );
  return (
    <img
      className={`mascot${className ? ` ${className}` : ""}`}
      src={src}
      width={size}
      height={size}
      alt={alt}
      draggable={false}
    />
  );
}