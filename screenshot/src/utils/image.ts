import sharp from 'sharp';

/**
 * Compares two images and returns the difference.
 * @param imagePath1 Path to the first image.
 * @param imagePath2 Path to the second image.
 * @returns {Promise<number>} A value indicating the difference (0 for identical).
 */
export async function compareImages(imagePath1: string, imagePath2: string): Promise<number> {
  const image1 = sharp(imagePath1);
  const image2 = sharp(imagePath2);

  const metadata1 = await image1.metadata();
  const metadata2 = await image2.metadata();

  // Resize images to the same dimensions for comparison
  const width = Math.max(metadata1.width || 0, metadata2.width || 0);
  const height = Math.max(metadata1.height || 0, metadata2.height || 0);

  const resizedImage1Buffer = await image1.resize(width, height).toBuffer();
  const resizedImage2Buffer = await image2.resize(width, height).toBuffer();

  const diff = await sharp(resizedImage1Buffer)
    .composite([{ input: resizedImage2Buffer, blend: 'difference' }])
    .toBuffer();

  const { data } = await sharp(diff).raw().toBuffer({ resolveWithObject: true });

  let diffValue = 0;
  for (let i = 0; i < data.length; i += 4) {
    diffValue += data[i] + data[i + 1] + data[i + 2];
  }

  return diffValue;
}
