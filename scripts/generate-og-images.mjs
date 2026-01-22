import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';

const CONTENT_DIR = './content/posts';

// 카테고리별 색상
const categoryColors = {
  'Terraform': { bg: '#7B42BC', accent: '#5C4EE5' },
  'ArgoCD': { bg: '#EF7B4D', accent: '#E95420' },
  'Kubernetes': { bg: '#326CE5', accent: '#2157D6' },
  'DevOps': { bg: '#0DB7ED', accent: '#0996C7' },
  'default': { bg: '#1a1a2e', accent: '#4a4a6a' }
};

async function generateOGImage(title, category, outputPath) {
  const colors = categoryColors[category] || categoryColors['default'];

  // Noto Sans KR 폰트 로드 (Google Fonts에서)
  const fontData = await fetch(
    'https://cdn.jsdelivr.net/fontsource/fonts/noto-sans-kr@latest/korean-700-normal.woff'
  ).then(res => res.arrayBuffer());

  // 24:8 (3:1) 비율 이미지
  const width = 900;
  const height = 300;

  const svg = await satori(
    {
      type: 'div',
      props: {
        style: {
          width: `${width}px`,
          height: `${height}px`,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          background: `linear-gradient(135deg, ${colors.bg} 0%, ${colors.accent} 100%)`,
          padding: '30px 60px',
        },
        children: [
          {
            type: 'div',
            props: {
              style: {
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                textAlign: 'center',
                width: '100%',
              },
              children: [
                // 카테고리 뱃지
                {
                  type: 'div',
                  props: {
                    style: {
                      backgroundColor: 'rgba(255,255,255,0.2)',
                      padding: '4px 12px',
                      borderRadius: '10px',
                      fontSize: '14px',
                      color: 'white',
                      marginBottom: '12px',
                    },
                    children: category || 'Blog',
                  },
                },
                // 제목
                {
                  type: 'div',
                  props: {
                    style: {
                      fontSize: title.length > 30 ? '22px' : '28px',
                      fontWeight: 700,
                      color: 'white',
                      lineHeight: 1.3,
                      maxWidth: '780px',
                      textAlign: 'center',
                    },
                    children: title,
                  },
                },
                // 저자
                {
                  type: 'div',
                  props: {
                    style: {
                      marginTop: '12px',
                      fontSize: '14px',
                      color: 'rgba(255,255,255,0.8)',
                    },
                    children: 'Jonghwa Baek',
                  },
                },
              ],
            },
          },
        ],
      },
    },
    {
      width: width,
      height: height,
      fonts: [
        {
          name: 'Noto Sans KR',
          data: fontData,
          weight: 700,
          style: 'normal',
        },
      ],
    }
  );

  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: width },
  });
  const pngData = resvg.render();
  const pngBuffer = pngData.asPng();

  writeFileSync(outputPath, pngBuffer);
  console.log(`Generated: ${outputPath}`);
}

function extractFrontMatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};

  const frontMatter = {};
  const lines = match[1].split('\n');

  for (const line of lines) {
    const [key, ...valueParts] = line.split(':');
    if (key && valueParts.length) {
      let value = valueParts.join(':').trim();
      // 따옴표 제거
      value = value.replace(/^["']|["']$/g, '');
      // 배열 처리
      if (value.startsWith('[')) {
        value = value.replace(/[\[\]"']/g, '').split(',').map(s => s.trim());
      }
      frontMatter[key.trim()] = value;
    }
  }

  return frontMatter;
}

async function main() {
  const postDirs = readdirSync(CONTENT_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  for (const dir of postDirs) {
    const postPath = join(CONTENT_DIR, dir, 'index.md');
    const outputPath = join(CONTENT_DIR, dir, 'featured.png');

    // 이미 featured 이미지가 있으면 스킵
    if (existsSync(outputPath)) {
      console.log(`Skipped (exists): ${outputPath}`);
      continue;
    }

    if (!existsSync(postPath)) continue;

    const content = readFileSync(postPath, 'utf-8');
    const frontMatter = extractFrontMatter(content);

    const title = frontMatter.title || dir;
    const category = Array.isArray(frontMatter.categories)
      ? frontMatter.categories[0]
      : frontMatter.categories || '';

    await generateOGImage(title, category, outputPath);
  }
}

main().catch(console.error);
