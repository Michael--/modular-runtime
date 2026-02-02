import { defineConfig } from 'vitepress'
import { withMermaid } from 'vitepress-plugin-mermaid'

/**
 * VitePress site configuration for modular-runtime.
 */
const config = withMermaid(
  defineConfig({
    lang: 'en-US',
    title: 'Modular Runtime',
    base: '/modular-runtime/',
    description:
      'Modular, polyglot services for breaking down large local monoliths without Kubernetes.',
    markdown: {
      // @ts-expect-error VitePress supports this, but TS picks wrong types
      mermaid: true,
      math: false,
    },
    mermaid: {
      flowchart: { htmlLabels: true },
      themeVariables: {
        fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Arial',
        fontSize: '16px',
      },
    },

    themeConfig: {
      nav: [
        { text: 'Guide', link: '/guide/overview' },
        { text: 'Demo Scenarios', link: '/guide/demo-scenarios' },
        { text: 'Performance', link: '/guide/performance' },
        { text: 'Results', link: '/guide/results' },
      ],
      sidebar: {
        '/guide/': [
          {
            text: 'Guide',
            items: [
              { text: 'Overview', link: '/guide/overview' },
              { text: 'Why Split', link: '/guide/why-split' },
              { text: 'Architecture', link: '/guide/architecture' },
              { text: 'Workspaces', link: '/guide/workspaces' },
            ],
          },
          {
            text: 'Demo & Results',
            items: [
              { text: 'Demo Scenarios', link: '/guide/demo-scenarios' },
              { text: 'Results Summary', link: '/guide/results' },
              { text: 'Performance Deep Dive', link: '/guide/performance' },
              { text: 'Rust Optimization', link: '/guide/rust-optimization' },
            ],
          },
        ],
      },
      outline: [2, 3],
      search: {
        provider: 'local',
      },
    },
    vite: {
      ssr: { noExternal: ['mermaid'] },
      optimizeDeps: { include: ['mermaid'] },
    },
  })
)

export default config
