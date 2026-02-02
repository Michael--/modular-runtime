import { defineConfig } from 'vitepress'

/**
 * VitePress site configuration for modular-runtime.
 */
const config = defineConfig({
  lang: 'en-US',
  title: 'Modular Runtime',
  description:
    'Modular, polyglot services for breaking down large local monoliths without Kubernetes.',
  themeConfig: {
    nav: [
      { text: 'Guide', link: '/guide/overview' },
      { text: 'Demo Scenarios', link: '/guide/demo-scenarios' },
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
            { text: 'Demo Scenarios', link: '/guide/demo-scenarios' },
            { text: 'Results', link: '/guide/results' },
          ],
        },
      ],
    },
    outline: [2, 3],
    search: {
      provider: 'local',
    },
  },
})

export default config
