/**
 * 将用户上传的图片文件居中裁剪为正方形并压缩为小尺寸 dataURL，
 * 用于学校图标等场景。失败时 reject 中文错误信息。
 */
export function fileToSquareDataUrl(
  file: File,
  size = 256,
  maxBytes = 200_000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) {
      reject(new Error("请选择图片文件"));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("读取图片失败"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("图片格式不支持"));
      img.onload = () => {
        const side = Math.min(img.width, img.height);
        const sx = (img.width - side) / 2;
        const sy = (img.height - side) / 2;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("无法创建画布"));
          return;
        }
        ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
        let url = canvas.toDataURL("image/png");
        if (url.length > maxBytes) {
          // PNG 超限时改为 JPEG（白底），进一步压缩
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, size, size);
          ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
          url = canvas.toDataURL("image/jpeg", 0.85);
        }
        if (url.length > maxBytes) {
          reject(new Error("图片过大，请换一张更小的图片"));
          return;
        }
        resolve(url);
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}