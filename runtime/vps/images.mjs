import sharp from 'sharp';

async function bytes(stream) {
  const reader = stream.getReader(), chunks = []; let size = 0;
  try {
    while (true) {
      const item = await reader.read(); if (item.done) break;
      size += item.value.byteLength;
      if (size > 6 * 1024 * 1024) throw new Error('Image too large.');
      chunks.push(Buffer.from(item.value));
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks);
}
export const images = {
  async info(stream) {
    const info = await sharp(await bytes(stream), { limitInputPixels: 40000000, animated: false }).metadata();
    return { width: info.width, height: info.height, format: 'image/' + info.format };
  },
  input(stream) {
    let dimensions = {};
    return {
      transform(options) { dimensions = options; return this; },
      async output(options) {
        const format = options.format.replace('image/', '');
        if (!['jpeg', 'png', 'webp', 'avif'].includes(format)) throw new Error('Unsupported image output.');
        const body = await sharp(await bytes(stream), { limitInputPixels: 40000000, animated: false })
          .rotate().resize({ width: dimensions.width, height: dimensions.height, fit: 'inside', withoutEnlargement: true })
          .toFormat(format, { quality: options.quality ?? 75 }).toBuffer();
        return { response() { return new Response(body, { headers: { 'content-type': options.format } }); } };
      },
    };
  },
};
