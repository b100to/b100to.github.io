import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';

const WIDTH = 1080;
const HEIGHT = 1080;

const COLORS = {
  bg: '#FFFFFF',
  bgAccent: '#F5F5F5',
  accent: '#2323AA',
  accentBg: 'rgba(35,35,170,0.08)',
  accentBorder: 'rgba(35,35,170,0.2)',
  text: '#111111',
  textSub: '#444444',
  textMuted: '#AAAAAA',
  cardBg: 'rgba(0,0,0,0.04)',
  cardBorder: 'rgba(0,0,0,0.08)',
  selectedBg: '#2323AA',
  selectedText: '#FFFFFF',
  before: '#F2F2F2',
  beforeBorder: 'rgba(0,0,0,0.1)',
  beforeText: '#666666',
  after: 'rgba(35,35,170,0.07)',
  afterBorder: 'rgba(35,35,170,0.2)',
  afterText: '#2323AA',
};

const OUTPUT_DIR = './scripts/linkedin-cards';

function loadImage(path) {
  const data = readFileSync(path);
  return `data:image/png;base64,${data.toString('base64')}`;
}

const IMAGES = {
  login: loadImage('./content/posts/k8s-sso-authentik/sso-login.png'),
  architecture: loadImage('./content/posts/k8s-sso-authentik/sso-architecture.png'),
  redirect: loadImage('./content/posts/k8s-sso-authentik/argo-workflows-redirect.png'),
  dashboard: loadImage('./content/posts/k8s-sso-authentik/sso-dashboard.png'),
};

async function loadFont() {
  const fontData = await fetch(
    'https://cdn.jsdelivr.net/fontsource/fonts/noto-sans-kr@latest/korean-700-normal.woff'
  ).then(res => res.arrayBuffer());
  return fontData;
}

function badge(text) {
  return {
    type: 'div',
    props: {
      style: {
        backgroundColor: COLORS.accentBg,
        border: `1px solid ${COLORS.accentBorder}`,
        padding: '6px 20px',
        borderRadius: '999px',
        fontSize: '22px',
        color: COLORS.accent,
        marginBottom: '28px',
        display: 'flex',
      },
      children: text,
    },
  };
}

function pageNum(current, total) {
  return {
    type: 'div',
    props: {
      style: {
        position: 'absolute',
        bottom: '40px',
        right: '52px',
        fontSize: '20px',
        color: COLORS.textMuted,
        display: 'flex',
      },
      children: `${current} / ${total}`,
    },
  };
}

function bg(children, pageN, totalN) {
  return {
    type: 'div',
    props: {
      style: {
        width: `${WIDTH}px`,
        height: `${HEIGHT}px`,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        background: `linear-gradient(145deg, ${COLORS.bg} 0%, ${COLORS.bgAccent} 100%)`,
        padding: '64px 72px',
        position: 'relative',
      },
      children: [...children, pageNum(pageN, totalN)],
    },
  };
}

function withImage(imgSrc, contentChildren, pageN, totalN) {
  return {
    type: 'div',
    props: {
      style: {
        width: `${WIDTH}px`,
        height: `${HEIGHT}px`,
        display: 'flex',
        flexDirection: 'column',
        background: `linear-gradient(145deg, ${COLORS.bg} 0%, ${COLORS.bgAccent} 100%)`,
        padding: '56px 64px',
        position: 'relative',
        gap: '32px',
      },
      children: [
        ...contentChildren,
        {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              flex: 1,
              borderRadius: '20px',
              overflow: 'hidden',
              border: `1px solid ${COLORS.cardBorder}`,
              boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
            },
            children: {
              type: 'img',
              props: {
                src: imgSrc,
                style: {
                  width: '100%',
                  height: '100%',
                  objectFit: 'contain',
                  borderRadius: '16px',
                },
              },
            },
          },
        },
        pageNum(pageN, totalN),
      ],
    },
  };
}

const TOTAL = 8;

function descText(text) {
  return {
    type: 'div',
    props: {
      style: { fontSize: '20px', color: COLORS.textSub, lineHeight: 1.6, display: 'flex', marginBottom: '28px' },
      children: text,
    },
  };
}

const cards = [
  // 1. Cover
  {
    type: 'div',
    props: {
      style: {
        width: `${WIDTH}px`,
        height: `${HEIGHT}px`,
        display: 'flex',
        flexDirection: 'row',
        background: `linear-gradient(145deg, ${COLORS.bg} 0%, ${COLORS.bgAccent} 100%)`,
        position: 'relative',
      },
      children: [
        {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              padding: '80px 48px 80px 72px',
              flex: 1,
              gap: '0px',
            },
            children: [
              badge('Kubernetes · SSO'),
              {
                type: 'div',
                props: {
                  style: { fontSize: '52px', fontWeight: 700, color: COLORS.text, lineHeight: 1.25, display: 'flex', flexDirection: 'column' },
                  children: 'Kubernetes\n클러스터\nSSO 도입기',
                },
              },
              {
                type: 'div',
                props: {
                  style: { marginTop: '20px', fontSize: '20px', color: COLORS.textSub, lineHeight: 1.6, display: 'flex' },
                  children: 'Authentik으로 ArgoCD, Grafana, Argo Workflows, Airflow, Kubecost까지 구글 계정 하나로 통합한 과정',
                },
              },
              {
                type: 'div',
                props: {
                  style: { marginTop: '36px', fontSize: '18px', color: COLORS.textMuted, display: 'flex' },
                  children: 'Jonghwa Baek',
                },
              },
            ],
          },
        },
        {
          type: 'div',
          props: {
            style: {
              width: '420px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '60px 48px 60px 0',
            },
            children: {
              type: 'img',
              props: {
                src: IMAGES.login,
                style: { width: '100%', borderRadius: '20px', boxShadow: '0 8px 40px rgba(0,0,0,0.12)' },
              },
            },
          },
        },
        pageNum(1, TOTAL),
      ],
    },
  },

  // 2. Problem
  bg([
    badge('문제'),
    {
      type: 'div',
      props: {
        style: { fontSize: '40px', fontWeight: 700, color: COLORS.text, marginBottom: '12px', display: 'flex' },
        children: '서비스마다 계정이 따로',
      },
    },
    descText('누군가 새로 합류하면 서비스마다 계정을 만들어줘야 했고, 떠날 때는 어디에 계정이 있는지 추적해서 하나씩 정리해야 했다.'),
    ...[
      ['ArgoCD', '별도 계정'],
      ['Grafana', '별도 계정'],
      ['Argo Workflows', '별도 계정'],
      ['Airflow', '별도 계정'],
      ['Kubecost', '인증 없음 (IP 제한만)'],
    ].map(([name, desc]) => ({
      type: 'div',
      props: {
        style: {
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          width: '100%',
          backgroundColor: COLORS.cardBg,
          border: `1px solid ${COLORS.cardBorder}`,
          borderRadius: '14px',
          padding: '14px 28px',
          marginBottom: '10px',
        },
        children: [
          { type: 'div', props: { style: { fontSize: '24px', color: COLORS.text, fontWeight: 700, display: 'flex' }, children: name } },
          { type: 'div', props: { style: { fontSize: '20px', color: COLORS.textSub, display: 'flex' }, children: desc } },
        ],
      },
    })),
  ], 2, TOTAL),

  // 3. Why Authentik
  bg([
    badge('왜 Authentik인가'),
    {
      type: 'div',
      props: {
        style: { fontSize: '40px', fontWeight: 700, color: COLORS.text, marginBottom: '12px', display: 'flex' },
        children: '3가지 후보 중 선택',
      },
    },
    descText('Keycloak은 UI 클릭 중심이라 GitOps로 관리하기 어렵다. Authentik은 Blueprint YAML로 앱 설정, 정책, 그룹까지 코드로 선언할 수 있다.'),
    ...[
      ['Okta', 'SaaS · 유저당 과금', false],
      ['Keycloak', 'Self-hosted · UI 중심', false],
      ['Authentik', 'Self-hosted · Blueprint YAML', true],
    ].map(([name, desc, selected]) => ({
      type: 'div',
      props: {
        style: {
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          width: '100%',
          backgroundColor: selected ? COLORS.selectedBg : COLORS.cardBg,
          border: `1px solid ${selected ? 'transparent' : COLORS.cardBorder}`,
          borderRadius: '14px',
          padding: '20px 28px',
          marginBottom: '12px',
        },
        children: [
          { type: 'div', props: { style: { fontSize: '26px', color: selected ? COLORS.selectedText : COLORS.text, fontWeight: 700, display: 'flex' }, children: name } },
          { type: 'div', props: { style: { fontSize: '20px', color: selected ? 'rgba(255,255,255,0.8)' : COLORS.textSub, display: 'flex' }, children: desc } },
          selected
            ? { type: 'div', props: { style: { fontSize: '20px', color: COLORS.selectedText, fontWeight: 700, display: 'flex' }, children: 'SELECT' } }
            : { type: 'div', props: { style: { display: 'none' }, children: ' ' } },
        ],
      },
    })),
  ], 3, TOTAL),

  // 4. Architecture
  withImage(IMAGES.architecture, [
    badge('아키텍처'),
    {
      type: 'div',
      props: {
        style: { fontSize: '38px', fontWeight: 700, color: COLORS.text, display: 'flex' },
        children: '전체 흐름',
      },
    },
    {
      type: 'div',
      props: {
        style: { fontSize: '19px', color: COLORS.textSub, marginTop: '12px', lineHeight: 1.7, display: 'flex', flexDirection: 'column' },
        children: [
          { type: 'div', props: { style: { display: 'flex', marginBottom: '6px' }, children: '사용자 요청은 Route53 - ALB - Traefik을 거쳐 각 서비스로 라우팅된다.' } },
          { type: 'div', props: { style: { display: 'flex', marginBottom: '6px' }, children: '각 서비스는 Authentik에 인증 요청을 보내고 OIDC/OAuth2/SAML로 처리한다.' } },
          { type: 'div', props: { style: { display: 'flex' }, children: 'OAuth 시크릿은 External Secrets가 AWS Secrets Manager에서 K8s Secret으로 자동 주입한다.' } },
        ],
      },
    },
  ], 4, TOTAL),

  // 5. Patterns
  bg([
    badge('연동 패턴'),
    {
      type: 'div',
      props: {
        style: { fontSize: '40px', fontWeight: 700, color: COLORS.text, marginBottom: '12px', display: 'flex' },
        children: '4가지 인증 방식',
      },
    },
    descText('앱마다 지원하는 프로토콜이 달라서 하나의 방식으로 통일하기가 어렵다. 케이스별로 맞는 패턴을 골라야 한다.'),
    ...[
      ['OIDC', 'ArgoCD, Argo Workflows', 'Public Client + PKCE로 CLI 로그인까지 동일 client 사용'],
      ['Generic OAuth', 'Grafana', 'role_attribute_path로 그룹 기반 권한 자동 매핑'],
      ['oauth2-proxy', 'Kubecost', '자체 인증 없는 앱 앞단에 프록시로 배치'],
      ['SAML', 'AWS Console', 'IAM User 없이 Authentik이 IdP 역할, 임시 자격증명 발급'],
    ].map(([pattern, apps, desc]) => ({
      type: 'div',
      props: {
        style: {
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'flex-start',
          width: '100%',
          backgroundColor: COLORS.cardBg,
          border: `1px solid ${COLORS.cardBorder}`,
          borderRadius: '14px',
          padding: '14px 24px',
          marginBottom: '10px',
          gap: '20px',
        },
        children: [
          { type: 'div', props: { style: { fontSize: '20px', color: COLORS.accent, fontWeight: 700, width: '170px', flexShrink: 0, display: 'flex', paddingTop: '2px' }, children: pattern } },
          { type: 'div', props: { style: { display: 'flex', flexDirection: 'column', gap: '2px' }, children: [
            { type: 'div', props: { style: { fontSize: '18px', color: COLORS.text, display: 'flex' }, children: apps } },
            { type: 'div', props: { style: { fontSize: '16px', color: COLORS.textSub, display: 'flex' }, children: desc } },
          ]}},
        ],
      },
    })),
  ], 5, TOTAL),

  // 6. Trouble
  withImage(IMAGES.redirect, [
    badge('삽질'),
    {
      type: 'div',
      props: {
        style: { fontSize: '36px', fontWeight: 700, color: COLORS.text, display: 'flex' },
        children: 'Argo Workflows 무한 리다이렉트',
      },
    },
    {
      type: 'div',
      props: {
        style: { fontSize: '18px', color: COLORS.textSub, marginTop: '10px', lineHeight: 1.6, display: 'flex' },
        children: 'Traefik 미들웨어로 SSO 리다이렉트를 걸었는데, 로그인 완료 후 다시 리다이렉트가 반복됐다. SSO 콜백 후 설정되는 authorization 쿠키 유무로 라우트를 분기해서 해결했다. Traefik v3에서 HeadersRegexp가 HeaderRegexp(단수형)로 바뀐 문법 변경도 겹쳤다.',
      },
    },
    {
      type: 'div',
      props: {
        style: { display: 'flex', flexDirection: 'row', gap: '14px', marginTop: '14px' },
        children: [
          {
            type: 'div',
            props: {
              style: { backgroundColor: COLORS.before, border: `1px solid ${COLORS.beforeBorder}`, borderRadius: '12px', padding: '12px 18px', flex: 1, display: 'flex' },
              children: { type: 'div', props: { style: { fontSize: '16px', color: COLORS.beforeText, display: 'flex' }, children: 'Before: / - SSO - 완료 - / - 또 SSO - 무한루프' } },
            },
          },
          {
            type: 'div',
            props: {
              style: { backgroundColor: COLORS.after, border: `1px solid ${COLORS.afterBorder}`, borderRadius: '12px', padding: '12px 18px', flex: 1, display: 'flex' },
              children: { type: 'div', props: { style: { fontSize: '16px', color: COLORS.afterText, display: 'flex' }, children: 'After: 쿠키 있으면 바로 통과, 없으면 SSO로 이동' } },
            },
          },
        ],
      },
    },
  ], 6, TOTAL),

  // 7. Result
  withImage(IMAGES.dashboard, [
    badge('결과'),
    {
      type: 'div',
      props: {
        style: { fontSize: '38px', fontWeight: 700, color: COLORS.text, display: 'flex' },
        children: '도입 전후 비교',
      },
    },
    {
      type: 'div',
      props: {
        style: { fontSize: '18px', color: COLORS.textSub, marginTop: '8px', lineHeight: 1.6, display: 'flex', marginBottom: '14px' },
        children: '가장 큰 성과는 보안 측면이다. IAM User 기반 장기 자격증명이 전면 제거됐고, AWS 콘솔도 SAML 임시 자격증명으로만 접근한다.',
      },
    },
    {
      type: 'div',
      props: {
        style: { display: 'flex', flexDirection: 'row', gap: '12px', width: '100%' },
        children: [
          {
            type: 'div',
            props: {
              style: { flex: 1, backgroundColor: COLORS.before, border: `1px solid ${COLORS.beforeBorder}`, borderRadius: '12px', padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: '7px' },
              children: [
                { type: 'div', props: { style: { fontSize: '16px', color: COLORS.beforeText, fontWeight: 700, marginBottom: '2px', display: 'flex' }, children: 'Before' } },
                ...['서비스별 계정 수동 생성', '서비스별 계정 수동 삭제', 'IAM User (장기 자격증명)', '액세스 키 수동 발급']
                  .map(t => ({ type: 'div', props: { style: { fontSize: '15px', color: COLORS.text, display: 'flex' }, children: t } })),
              ],
            },
          },
          {
            type: 'div',
            props: {
              style: { flex: 1, backgroundColor: COLORS.after, border: `1px solid ${COLORS.afterBorder}`, borderRadius: '12px', padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: '7px' },
              children: [
                { type: 'div', props: { style: { fontSize: '16px', color: COLORS.afterText, fontWeight: 700, marginBottom: '2px', display: 'flex' }, children: 'After' } },
                ...['Google 계정 + 그룹 추가 1번', 'Authentik 계정 비활성화 1번', 'SAML (임시 자격증명)', 'OIDC 자동 갱신']
                  .map(t => ({ type: 'div', props: { style: { fontSize: '15px', color: COLORS.text, display: 'flex' }, children: t } })),
              ],
            },
          },
        ],
      },
    },
  ], 7, TOTAL),

  // 8. Wrap-up
  bg([
    badge('마무리'),
    {
      type: 'div',
      props: {
        style: { fontSize: '20px', color: COLORS.textSub, lineHeight: 1.7, display: 'flex', marginBottom: '32px' },
        children: '처음엔 "SSO 하나 붙이면 되는 거 아냐?" 싶었는데, 앱마다 프로토콜이 달랐고 K8s 버전 변경, Traefik v3 마이그레이션까지 맞물려 생각보다 손이 많이 갔다.',
      },
    },
    ...[
      '신규 서비스 추가 시 Blueprint에 앱 하나 추가하면 끝',
      '장기 자격증명(IAM User) 전면 제거',
      'GitOps로 SSO 설정까지 코드로 관리',
    ].map(text => ({
      type: 'div',
      props: {
        style: {
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          width: '100%',
          backgroundColor: COLORS.cardBg,
          border: `1px solid ${COLORS.cardBorder}`,
          borderRadius: '14px',
          padding: '20px 28px',
          marginBottom: '14px',
          gap: '16px',
        },
        children: [
          { type: 'div', props: { style: { width: '8px', height: '8px', borderRadius: '50%', backgroundColor: COLORS.accent, flexShrink: 0, display: 'flex' }, children: ' ' } },
          { type: 'div', props: { style: { fontSize: '22px', color: COLORS.text, display: 'flex' }, children: text } },
        ],
      },
    })),
    {
      type: 'div',
      props: {
        style: { marginTop: '36px', fontSize: '20px', color: COLORS.textMuted, display: 'flex' },
        children: 'b100to.github.io',
      },
    },
  ], 8, TOTAL),
];

async function main() {
  if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });

  const fontData = await loadFont();

  for (let i = 0; i < cards.length; i++) {
    const svg = await satori(cards[i], {
      width: WIDTH,
      height: HEIGHT,
      fonts: [{ name: 'Noto Sans KR', data: fontData, weight: 700, style: 'normal' }],
    });

    const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: WIDTH } });
    const pngBuffer = resvg.render().asPng();
    const outputPath = join(OUTPUT_DIR, `card-${String(i + 1).padStart(2, '0')}.png`);
    writeFileSync(outputPath, pngBuffer);
    console.log(`Generated: ${outputPath}`);
  }
}

main().catch(console.error);
