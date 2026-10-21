import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 16, children, ...rest }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
      {children}
    </svg>
  );
}

export const Chevron = (p: P) => (
  <Svg {...p}>
    <path d="M6 4l4 4-4 4" />
  </Svg>
);
export const FolderIcon = (p: P) => (
  <Svg {...p}>
    <path d="M1.75 4.25c0-.69.56-1.25 1.25-1.25h3l1.5 1.5H13c.69 0 1.25.56 1.25 1.25v6.5c0 .69-.56 1.25-1.25 1.25H3c-.69 0-1.25-.56-1.25-1.25z" />
  </Svg>
);
export const FolderFilledIcon = (p: P) => (
  <Svg {...p}>
    <path
      d="M1.75 4.25c0-.69.56-1.25 1.25-1.25h3l1.5 1.5H13c.69 0 1.25.56 1.25 1.25v6.5c0 .69-.56 1.25-1.25 1.25H3c-.69 0-1.25-.56-1.25-1.25z"
      fill="currentColor"
    />
  </Svg>
);
export const CollectionIcon = (p: P) => (
  <Svg {...p}>
    <rect x="2" y="2.5" width="12" height="3" rx="1" />
    <rect x="2" y="7" width="12" height="3" rx="1" />
    <rect x="2" y="11.5" width="12" height="2.5" rx="1" />
  </Svg>
);
export const ProjectIcon = (p: P) => (
  <Svg {...p}>
    <path d="M4 1.75h5.5L12.5 4.75v9.5H4z" />
    <path d="M9.25 1.75v3.25h3.25" />
    <path d="M6 8.5h4.5M6 11h4.5" />
  </Svg>
);
export const FileIcon = (p: P) => (
  <Svg {...p}>
    <path d="M4 1.75h5L12 4.75v9.5H4z" />
    <path d="M8.75 1.75v3.25H12" />
  </Svg>
);
export const ImageIcon = (p: P) => (
  <Svg {...p}>
    <rect x="2" y="3" width="12" height="10" rx="1.5" />
    <circle cx="5.75" cy="6.5" r="1.25" />
    <path d="M2.5 12l3.5-3.5 2.5 2.5 2-2 3 3" />
  </Svg>
);
export const TemplateIcon = (p: P) => (
  <Svg {...p}>
    <rect x="4.5" y="4.5" width="9" height="9.5" rx="1" />
    <path d="M11.5 4.5V2.75c0-.55-.45-1-1-1H3c-.55 0-1 .45-1 1v8c0 .55.45 1 1 1h1.5" />
  </Svg>
);
export const PlusIcon = (p: P) => (
  <Svg {...p}>
    <path d="M8 3v10M3 8h10" />
  </Svg>
);
export const ClockIcon = (p: P) => (
  <Svg {...p}>
    <circle cx="8" cy="8" r="6.25" />
    <path d="M8 4.5V8l2.5 1.5" />
  </Svg>
);
export const ExportIcon = (p: P) => (
  <Svg {...p}>
    <path d="M8 10V2M5 5l3-3 3 3" />
    <path d="M3 9v4.25h10V9" />
  </Svg>
);
export const WarningIcon = (p: P) => (
  <Svg {...p}>
    <path d="M8 2l6.5 11.5h-13z" />
    <path d="M8 6.5v3M8 11.5v.01" />
  </Svg>
);
export const CloseIcon = (p: P) => (
  <Svg {...p}>
    <path d="M4 4l8 8M12 4l-8 8" />
  </Svg>
);
export const MoreIcon = (p: P) => (
  <Svg {...p}>
    <circle cx="3.5" cy="8" r=".9" fill="currentColor" />
    <circle cx="8" cy="8" r=".9" fill="currentColor" />
    <circle cx="12.5" cy="8" r=".9" fill="currentColor" />
  </Svg>
);
export const RestoreIcon = (p: P) => (
  <Svg {...p}>
    <path d="M2.5 8a5.5 5.5 0 105.5-5.5c-1.7 0-3.2.8-4.2 2" />
    <path d="M3.5 2v3h3" />
  </Svg>
);
