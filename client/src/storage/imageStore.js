// 图片存储：优先写入 App 内部存储（原生桥），否则回退为内联 dataURL。
// 原生桥由 MainActivity 中的 @JavascriptInterface 提供（window.ImageStorage）。

export function hasNativeStorage() {
  return !!(window.ImageStorage && typeof window.ImageStorage.saveImage === 'function');
}

/** 读取文件 -> 等比压缩 -> JPEG dataURL */
export function compressImage(file, maxSize, quality) {
  maxSize = maxSize || 1280;
  quality = quality || 0.78;
  return new Promise(function (resolve, reject) {
    var reader = new FileReader();
    reader.onerror = function () { reject(new Error('读取图片失败')); };
    reader.onload = function (e) {
      var img = new Image();
      img.onerror = function () { reject(new Error('图片解析失败')); };
      img.onload = function () {
        var w = img.width, h = img.height;
        if (w > maxSize) { h = Math.round(h * maxSize / w); w = maxSize; }
        if (h > maxSize) { w = Math.round(w * maxSize / h); h = maxSize; }
        var c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(c.toDataURL('image/jpeg', quality));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

/**
 * 持久化一张图片。
 * 返回 { src, name, native }
 *   native=true  → src 是 file:// 内部路径，name 用于删除
 *   native=false → src 是 dataURL（浏览器/无原生桥时的回退）
 */
export function persistImage(dataUrl, prefix) {
  var name = (prefix || 'img') + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6) + '.jpg';
  if (hasNativeStorage()) {
    try {
      var path = window.ImageStorage.saveImage(name, dataUrl);
      if (path) return { src: path, name: name, native: true };
    } catch (e) {
      // 落到回退方案
    }
  }
  return { src: dataUrl, name: name, native: false };
}

export function deleteImage(name) {
  if (!name || !hasNativeStorage()) return;
  try {
    if (window.ImageStorage.deleteImage) window.ImageStorage.deleteImage(name);
  } catch (e) {
    // 忽略
  }
}
