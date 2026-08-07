import { useState } from "react";

const MASCOT_IMAGES = [
  "/mascots/mascot-1.png",
  "/mascots/mascot-2.png",
  "/mascots/mascot-3.png",
  "/mascots/mascot-4.png",
  "/mascots/mascot-5.png",
  "/mascots/mascot-6.png",
  "/mascots/mascot-7.png",
];

// 模块级轮换游标：同一次会话内按顺序分配，同一页面出现的多个吉祥物尽量不重复。
let mascotCursor = -1;

/** 项目彩蛋吉祥物：每次挂载轮换一位，出现在登录页角落/空状态/关于页。 */
export default function Mascot({
  className = "",
  size = 56,
  alt = "",
}: {
  className?: string;
  size?: number;
  alt?: string;
}) {
  const [src] = useState(() => {
    mascotCursor = (mascotCursor + 1) % MASCOT_IMAGES.length;
    return MASCOT_IMAGES[mascotCursor];
  });
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