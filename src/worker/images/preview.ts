import sharp from 'sharp';
import { prisma } from '@/server/db';
import { designFor, type TemplateSet } from '@/core/image-design';
import { registerControlHandler } from '../control';
import { renderDesign } from './render';
import { accentColour, loadLogo } from './website-images';

/** Sample pictures for the preview: soft gradients with a simple portrait silhouette. */
async function sample(i: number, w: number, h: number): Promise<Buffer> {
  const colors = [
    ['#f97316', '#7c3aed'],
    ['#0ea5e9', '#22c55e'],
    ['#e11d48', '#facc15'],
  ][i % 3]!;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${colors[0]}"/><stop offset="1" stop-color="${colors[1]}"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><circle cx="${w / 2}" cy="${h * 0.36}" r="${Math.min(w, h) * 0.16}" fill="rgba(255,255,255,0.55)"/><ellipse cx="${w / 2}" cy="${h * 0.92}" rx="${Math.min(w, h) * 0.34}" ry="${h * 0.3}" fill="rgba(255,255,255,0.45)"/><text x="${w / 2}" y="${h * 0.62}" font-family="Arial" font-size="${Math.round(h / 14)}" fill="white" text-anchor="middle">Picture ${i + 1}</text></svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 85 }).toBuffer();
}

registerControlHandler('render-preview', async (data) => {
  const website = await prisma.website.findUnique({ where: { id: String(data.websiteId) } });
  if (!website) throw new Error('Website not found.');
  const settings = {
    accentColour: (data.accentColour as string | null | undefined) ?? website.accentColour,
    logoPosition: String(data.logoPosition ?? website.logoPosition),
    featuredStyle: String(data.featuredStyle ?? website.featuredStyle),
    imageTemplate: data.imageTemplate !== undefined ? (data.imageTemplate ? JSON.stringify(data.imageTemplate as TemplateSet) : null) : website.imageTemplate,
  };
  const logo = await loadLogo(website);
  const accent = await accentColour({ accentColour: settings.accentColour, logoFile: website.logoFile }, logo);
  const pics = [await sample(0, 1200, 1500), await sample(1, 1500, 1200), await sample(2, 1600, 1000)];
  const sizes = [
    { w: 1200, h: 1500 },
    { w: 1500, h: 1200 },
  ];
  const featured = await renderDesign(designFor('featured', settings, accent), {
    pictures: [0, 1].map((i) => ({ buffer: pics[i]!, width: sizes[i]!.w, height: sizes[i]!.h, faces: [{ x: sizes[i]!.w * 0.4, y: sizes[i]!.h * 0.25, w: sizes[i]!.w * 0.2, h: sizes[i]!.h * 0.2 }] })),
    logo,
    vars: { title: 'Example Article Title', keyword: 'Example Name', image_text: 'Example Name' },
  });
  const body = await renderDesign(designFor('body', settings, accent, 1), { pictures: [{ buffer: pics[2]!, width: 1600, height: 1000 }], logo, vars: { title: 'Example Article Title', keyword: 'Example Name' } });
  const small = async (png: Buffer) => `data:image/jpeg;base64,${(await sharp(png).resize(960).jpeg({ quality: 82 }).toBuffer()).toString('base64')}`;
  return { featured: await small(featured), body: await small(body), accent };
});
