# Diagrams

Sources are `.mmd` files. The `.svg` files are rendered from them and committed so GitHub does not need a Mermaid runtime, which is what produced "Unable to render rich display" in some clients.

Rendered with Mermaid 10.9.1, `htmlLabels: false`, strict security level, and a white background rect so the diagrams stay readable in dark mode.

To regenerate, render each `.mmd` with Mermaid CLI:

```bash
npx -p @mermaid-js/mermaid-cli mmdc -i docs/diagrams/src/system-map.mmd -o docs/diagrams/system-map.svg -b white
```

Note that CLI defaults enable HTML labels, which become `foreignObject` and may be stripped by GitHub's SVG sanitizer. Keep SVG text labels.
