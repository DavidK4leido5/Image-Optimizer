import { RATIO_PRESETS, WIDTH_PRESETS, buildSrcSet, presetUrl } from '../presets';

type Props = {
  publicId: string;
  imageBase: string;
  onCopy: (text: string, message?: string) => void;
};

const SIZES = '(max-width: 768px) 100vw, 50vw';

export function ResponsivePresets({ publicId, imageBase, onCopy }: Props) {
  const src = presetUrl(imageBase, publicId, 'xl');
  const srcSet = buildSrcSet(imageBase, publicId);
  const snippet =
    '<img\n' +
    '  src="' + src + '"\n' +
    '  srcset="' + srcSet.replace(/, /g, ',\n          ') + '"\n' +
    '  sizes="' + SIZES + '"\n' +
    '  alt="">';

  return (
    <section className="presets" aria-labelledby={'presets-' + publicId}>
      <div className="presets__head">
        <div>
          <h3 id={'presets-' + publicId}>Responsive presets</h3>
          <p className="muted">
            Width presets keep the full frame. Ratio presets crop to their box. Generated on first request,
            then cached at the CDN.
          </p>
        </div>
        <button type="button" className="drawer__copy" onClick={() => onCopy(snippet, 'srcset copied')}>
          Copy srcset
        </button>
      </div>

      <pre className="presets__code"><code>{snippet}</code></pre>

      <div className="presets__list">
        {WIDTH_PRESETS.map((preset) => (
          <a
            key={preset.name}
            className="preset"
            href={presetUrl(imageBase, publicId, preset.name)}
            target="_blank"
            rel="noreferrer"
          >
            <span className="preset__name">{preset.name}</span>
            <span className="preset__meta">{preset.width}w · {preset.label}</span>
          </a>
        ))}
      </div>

      <div className="presets__list presets__list--ratio">
        {RATIO_PRESETS.map((preset) => (
          <a
            key={preset.name}
            className="preset"
            href={presetUrl(imageBase, publicId, preset.name)}
            target="_blank"
            rel="noreferrer"
          >
            <span className="preset__name">{preset.name}</span>
            <span className="preset__meta">
              {preset.width}×{preset.height} · {preset.ratio} · {preset.mode === 'pad' ? 'padded' : 'cropped'}
            </span>
          </a>
        ))}
      </div>
    </section>
  );
}
