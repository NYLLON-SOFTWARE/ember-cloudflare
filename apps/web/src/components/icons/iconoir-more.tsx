import { DOT, IconoirIcon, LINE, OUTLINE, ROUND_ENDS, type IconoirIconProps } from "./iconoir-base";

// Iconoir's icons, as iconoir.tsx holds them, that only the pages few visits need draw (pages.ts), which load
// with those pages rather than in the app's script. icons.test.tsx checks them as it checks iconoir.tsx's.

export function Camera(props: IconoirIconProps) {
  return (
    <IconoirIcon name="camera" {...props}>
      <path
        d="M2 19V9C2 7.89543 2.89543 7 4 7H4.5C5.12951 7 5.72229 6.70361 6.1 6.2L8.32 3.24C8.43331 3.08892 8.61115 3 8.8 3H15.2C15.3889 3 15.5667 3.08892 15.68 3.24L17.9 6.2C18.2777 6.70361 18.8705 7 19.5 7H20C21.1046 7 22 7.89543 22 9V19C22 20.1046 21.1046 21 20 21H4C2.89543 21 2 20.1046 2 19Z"
        {...LINE}
      />
      <path d="M12 17C14.2091 17 16 15.2091 16 13C16 10.7909 14.2091 9 12 9C9.79086 9 8 10.7909 8 13C8 15.2091 9.79086 17 12 17Z" {...LINE} />
    </IconoirIcon>
  );
}

export function ClockRotateRight(props: IconoirIconProps) {
  return (
    <IconoirIcon name="clock-rotate-right" {...props}>
      <path d="M12 6L12 12L18 12" {...LINE} />
      <path
        d="M21.8883 10.5C21.1645 5.68874 17.013 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22C16.1006 22 19.6248 19.5318 21.1679 16"
        {...LINE}
      />
      <path d="M17 16H21.4C21.7314 16 22 16.2686 22 16.6V21" {...LINE} />
    </IconoirIcon>
  );
}

export function Code(props: IconoirIconProps) {
  return (
    <IconoirIcon name="code" {...props}>
      <path d="M13.5 6L10 18.5" {...LINE} />
      <path d="M6.5 8.5L3 12L6.5 15.5" {...LINE} />
      <path d="M17.5 8.5L21 12L17.5 15.5" {...LINE} />
    </IconoirIcon>
  );
}

export function Community(props: IconoirIconProps) {
  return (
    <IconoirIcon name="community" {...props}>
      <path d="M7 18V17C7 14.2386 9.23858 12 12 12V12C14.7614 12 17 14.2386 17 17V18" {...LINE} />
      <path d="M1 18V17C1 15.3431 2.34315 14 4 14V14" {...LINE} />
      <path d="M23 18V17C23 15.3431 21.6569 14 20 14V14" {...LINE} />
      <path d="M12 12C13.6569 12 15 10.6569 15 9C15 7.34315 13.6569 6 12 6C10.3431 6 9 7.34315 9 9C9 10.6569 10.3431 12 12 12Z" {...LINE} />
      <path d="M4 14C5.10457 14 6 13.1046 6 12C6 10.8954 5.10457 10 4 10C2.89543 10 2 10.8954 2 12C2 13.1046 2.89543 14 4 14Z" {...LINE} />
      <path d="M20 14C21.1046 14 22 13.1046 22 12C22 10.8954 21.1046 10 20 10C18.8954 10 18 10.8954 18 12C18 13.1046 18.8954 14 20 14Z" {...LINE} />
    </IconoirIcon>
  );
}

export function Crown(props: IconoirIconProps) {
  return (
    <IconoirIcon name="crown" {...props}>
      <path d="M19.2 17L21 7L14.7 10L12 7L9.3 10L3 7L4.8 17H19.2Z" {...LINE} />
    </IconoirIcon>
  );
}

export function DotsGrid3x3(props: IconoirIconProps) {
  return (
    <IconoirIcon name="dots-grid-3x3" {...props}>
      <path d="M5.5 6C5.77614 6 6 5.77614 6 5.5C6 5.22386 5.77614 5 5.5 5C5.22386 5 5 5.22386 5 5.5C5 5.77614 5.22386 6 5.5 6Z" {...DOT} />
      <path
        d="M5.5 12.5C5.77614 12.5 6 12.2761 6 12C6 11.7239 5.77614 11.5 5.5 11.5C5.22386 11.5 5 11.7239 5 12C5 12.2761 5.22386 12.5 5.5 12.5Z"
        {...DOT}
      />
      <path d="M5.5 19C5.77614 19 6 18.7761 6 18.5C6 18.2239 5.77614 18 5.5 18C5.22386 18 5 18.2239 5 18.5C5 18.7761 5.22386 19 5.5 19Z" {...DOT} />
      <path
        d="M12 6C12.2761 6 12.5 5.77614 12.5 5.5C12.5 5.22386 12.2761 5 12 5C11.7239 5 11.5 5.22386 11.5 5.5C11.5 5.77614 11.7239 6 12 6Z"
        {...DOT}
      />
      <path
        d="M12 12.5C12.2761 12.5 12.5 12.2761 12.5 12C12.5 11.7239 12.2761 11.5 12 11.5C11.7239 11.5 11.5 11.7239 11.5 12C11.5 12.2761 11.7239 12.5 12 12.5Z"
        {...DOT}
      />
      <path
        d="M12 19C12.2761 19 12.5 18.7761 12.5 18.5C12.5 18.2239 12.2761 18 12 18C11.7239 18 11.5 18.2239 11.5 18.5C11.5 18.7761 11.7239 19 12 19Z"
        {...DOT}
      />
      <path d="M18.5 6C18.7761 6 19 5.77614 19 5.5C19 5.22386 18.7761 5 18.5 5C18.2239 5 18 5.22386 18 5.5C18 5.77614 18.2239 6 18.5 6Z" {...DOT} />
      <path
        d="M18.5 12.5C18.7761 12.5 19 12.2761 19 12C19 11.7239 18.7761 11.5 18.5 11.5C18.2239 11.5 18 11.7239 18 12C18 12.2761 18.2239 12.5 18.5 12.5Z"
        {...DOT}
      />
      <path
        d="M18.5 19C18.7761 19 19 18.7761 19 18.5C19 18.2239 18.7761 18 18.5 18C18.2239 18 18 18.2239 18 18.5C18 18.7761 18.2239 19 18.5 19Z"
        {...DOT}
      />
    </IconoirIcon>
  );
}

export function DownloadDataWindow(props: IconoirIconProps) {
  return (
    <IconoirIcon name="download-data-window" {...props}>
      <path d="M14 21H4C2.89543 21 2 20.1046 2 19V5C2 3.89543 2.89543 3 4 3H20C21.1046 3 22 3.89543 22 5V14" {...ROUND_ENDS} />
      <path d="M2 7L22 7" {...LINE} />
      <path d="M5 5.01L5.01 4.99889" {...LINE} />
      <path d="M8 5.01L8.01 4.99889" {...LINE} />
      <path d="M11 5.01L11.01 4.99889" {...LINE} />
      <path d="M19.5 16V22M19.5 22L17 19.5M19.5 22L22 19.5" {...LINE} />
    </IconoirIcon>
  );
}

export function Eye(props: IconoirIconProps) {
  return (
    <IconoirIcon name="eye" {...props}>
      <path d="M3 13C6.6 5 17.4 5 21 13" {...LINE} />
      <path d="M12 17C10.3431 17 9 15.6569 9 14C9 12.3431 10.3431 11 12 11C13.6569 11 15 12.3431 15 14C15 15.6569 13.6569 17 12 17Z" {...LINE} />
    </IconoirIcon>
  );
}

export function FilterList(props: IconoirIconProps) {
  return (
    <IconoirIcon name="filter-list" {...props}>
      <path d="M3 6H21" {...LINE} />
      <path d="M7 12L17 12" {...LINE} />
      <path d="M11 18L13 18" {...LINE} />
    </IconoirIcon>
  );
}

export function GridPlus(props: IconoirIconProps) {
  return (
    <IconoirIcon name="grid-plus" {...props}>
      <path d="M13.9922 17H16.9922M19.9922 17H16.9922M16.9922 17V14M16.9922 17V20" {...LINE} />
      <path
        d="M4 9.4V4.6C4 4.26863 4.26863 4 4.6 4H9.4C9.73137 4 10 4.26863 10 4.6V9.4C10 9.73137 9.73137 10 9.4 10H4.6C4.26863 10 4 9.73137 4 9.4Z"
        {...OUTLINE}
      />
      <path
        d="M4 19.4V14.6C4 14.2686 4.26863 14 4.6 14H9.4C9.73137 14 10 14.2686 10 14.6V19.4C10 19.7314 9.73137 20 9.4 20H4.6C4.26863 20 4 19.7314 4 19.4Z"
        {...OUTLINE}
      />
      <path
        d="M14 9.4V4.6C14 4.26863 14.2686 4 14.6 4H19.4C19.7314 4 20 4.26863 20 4.6V9.4C20 9.73137 19.7314 10 19.4 10H14.6C14.2686 10 14 9.73137 14 9.4Z"
        {...OUTLINE}
      />
    </IconoirIcon>
  );
}

export function JournalPage(props: IconoirIconProps) {
  return (
    <IconoirIcon name="journal-page" {...props}>
      <path d="M6 6L14 6" {...LINE} />
      <path d="M6 10H18" {...LINE} />
      <path d="M13 14L18 14" {...LINE} />
      <path d="M13 18L18 18" {...LINE} />
      <path
        d="M2 21.4V2.6C2 2.26863 2.26863 2 2.6 2H18.2515C18.4106 2 18.5632 2.06321 18.6757 2.17574L21.8243 5.32426C21.9368 5.43679 22 5.5894 22 5.74853V21.4C22 21.7314 21.7314 22 21.4 22H2.6C2.26863 22 2 21.7314 2 21.4Z"
        {...LINE}
      />
      <path d="M6 18V14H9V18H6Z" {...LINE} />
      <path d="M18 2V5.4C18 5.73137 18.2686 6 18.6 6H22" {...LINE} />
    </IconoirIcon>
  );
}

export function LogOut(props: IconoirIconProps) {
  return (
    <IconoirIcon name="log-out" {...props}>
      <path d="M12 12H19M19 12L16 15M19 12L16 9" {...LINE} />
      <path
        d="M19 6V5C19 3.89543 18.1046 3 17 3H7C5.89543 3 5 3.89543 5 5V19C5 20.1046 5.89543 21 7 21H17C18.1046 21 19 20.1046 19 19V18"
        {...LINE}
      />
    </IconoirIcon>
  );
}

export function Mail(props: IconoirIconProps) {
  return (
    <IconoirIcon name="mail" {...props}>
      <path d="M7 9L12 12.5L17 9" {...LINE} />
      <path
        d="M2 17V7C2 5.89543 2.89543 5 4 5H20C21.1046 5 22 5.89543 22 7V17C22 18.1046 21.1046 19 20 19H4C2.89543 19 2 18.1046 2 17Z"
        {...OUTLINE}
      />
    </IconoirIcon>
  );
}

export function MediaImage(props: IconoirIconProps) {
  return (
    <IconoirIcon name="media-image" {...props}>
      <path
        d="M21 3.6V20.4C21 20.7314 20.7314 21 20.4 21H3.6C3.26863 21 3 20.7314 3 20.4V3.6C3 3.26863 3.26863 3 3.6 3H20.4C20.7314 3 21 3.26863 21 3.6Z"
        {...LINE}
      />
      <path d="M3 16L10 13L21 18" {...LINE} />
      <path d="M16 10C14.8954 10 14 9.10457 14 8C14 6.89543 14.8954 6 16 6C17.1046 6 18 6.89543 18 8C18 9.10457 17.1046 10 16 10Z" {...LINE} />
    </IconoirIcon>
  );
}

export function MediaVideo(props: IconoirIconProps) {
  return (
    <IconoirIcon name="media-video" {...props}>
      <path
        d="M21 3.6V20.4C21 20.7314 20.7314 21 20.4 21H3.6C3.26863 21 3 20.7314 3 20.4V3.6C3 3.26863 3.26863 3 3.6 3H20.4C20.7314 3 21 3.26863 21 3.6Z"
        {...LINE}
      />
      <path
        d="M9.89768 8.51296C9.49769 8.28439 9 8.57321 9 9.03391V14.9661C9 15.4268 9.49769 15.7156 9.89768 15.487L15.0883 12.5209C15.4914 12.2906 15.4914 11.7094 15.0883 11.4791L9.89768 8.51296Z"
        {...LINE}
      />
    </IconoirIcon>
  );
}

export function Microphone(props: IconoirIconProps) {
  return (
    <IconoirIcon name="microphone" {...props}>
      <rect x="9" y="2" width="6" height="12" rx="3" {...OUTLINE} />
      <path d="M5 10V11C5 14.866 8.13401 18 12 18V18V18C15.866 18 19 14.866 19 11V10" {...LINE} />
      <path d="M12 18V22M12 22H9M12 22H15" {...LINE} />
    </IconoirIcon>
  );
}

export function MicrophoneMute(props: IconoirIconProps) {
  return (
    <IconoirIcon name="microphone-mute" {...props}>
      <path d="M3 3L21 21" {...LINE} />
      <path d="M9 9V9C9 11.7614 11.2386 14 14 14V14M15 10.5V5C15 3.34315 13.6569 2 12 2V2C10.3431 2 9 3.34315 9 5V5.5" {...LINE} />
      <path d="M5 10V11C5 14.866 8.13401 18 12 18V18V18C15.866 18 19 14.866 19 11V10" {...LINE} />
      <path d="M12 18V22M12 22H9M12 22H15" {...LINE} />
    </IconoirIcon>
  );
}

export function MoreVert(props: IconoirIconProps) {
  return (
    <IconoirIcon name="more-vert" {...props}>
      <path
        d="M12 12.5C12.2761 12.5 12.5 12.2761 12.5 12C12.5 11.7239 12.2761 11.5 12 11.5C11.7239 11.5 11.5 11.7239 11.5 12C11.5 12.2761 11.7239 12.5 12 12.5Z"
        {...DOT}
      />
      <path
        d="M12 20.5C12.2761 20.5 12.5 20.2761 12.5 20C12.5 19.7239 12.2761 19.5 12 19.5C11.7239 19.5 11.5 19.7239 11.5 20C11.5 20.2761 11.7239 20.5 12 20.5Z"
        {...DOT}
      />
      <path
        d="M12 4.5C12.2761 4.5 12.5 4.27614 12.5 4C12.5 3.72386 12.2761 3.5 12 3.5C11.7239 3.5 11.5 3.72386 11.5 4C11.5 4.27614 11.7239 4.5 12 4.5Z"
        {...DOT}
      />
    </IconoirIcon>
  );
}

export function MusicDoubleNote(props: IconoirIconProps) {
  return (
    <IconoirIcon name="music-double-note" {...props}>
      <path d="M20 14V3L9 5V16" {...LINE} />
      <path d="M17 19H18C19.1046 19 20 18.1046 20 17V14H17C15.8954 14 15 14.8954 15 16V17C15 18.1046 15.8954 19 17 19Z" {...LINE} />
      <path d="M6 21H7C8.10457 21 9 20.1046 9 19V16H6C4.89543 16 4 16.8954 4 18V19C4 20.1046 4.89543 21 6 21Z" {...LINE} />
    </IconoirIcon>
  );
}

export function OpenNewWindow(props: IconoirIconProps) {
  return (
    <IconoirIcon name="open-new-window" {...props}>
      <path d="M21 3L15 3M21 3L12 12M21 3V9" {...LINE} />
      <path d="M21 13V19C21 20.1046 20.1046 21 19 21H5C3.89543 21 3 20.1046 3 19V5C3 3.89543 3.89543 3 5 3H11" {...ROUND_ENDS} />
    </IconoirIcon>
  );
}

export function Presentation(props: IconoirIconProps) {
  return (
    <IconoirIcon name="presentation" {...props}>
      <path
        d="M22 4.6V17.4C22 17.7314 21.7314 18 21.4 18H2.6C2.26863 18 2 17.7314 2 17.4V4.6C2 4.26863 2.26863 4 2.6 4H21.4C21.7314 4 22 4.26863 22 4.6Z"
        {...LINE}
      />
      <path d="M8.5 21.5L12 18L15.5 21.5" {...LINE} />
      <path d="M12 2V4" {...LINE} />
      <path d="M9 12V14" {...LINE} />
      <path d="M12 10V14" {...LINE} />
      <path d="M15 8V14" {...LINE} />
    </IconoirIcon>
  );
}

export function Prohibition(props: IconoirIconProps) {
  return (
    <IconoirIcon name="prohibition" {...props}>
      <path
        d="M19.1414 5C17.3265 3.14864 14.7974 2 12 2C6.47715 2 2 6.47715 2 12C2 14.7255 3.09032 17.1962 4.85857 19M19.1414 5C20.9097 6.80375 22 9.27455 22 12C22 17.5228 17.5228 22 12 22C9.20261 22 6.67349 20.8514 4.85857 19M19.1414 5L4.85857 19"
        {...LINE}
      />
    </IconoirIcon>
  );
}

export function RefreshDouble(props: IconoirIconProps) {
  return (
    <IconoirIcon name="refresh-double" {...props}>
      <path d="M21.1679 8C19.6247 4.46819 16.1006 2 11.9999 2C6.81459 2 2.55104 5.94668 2.04932 11" {...LINE} />
      <path d="M17 8H21.4C21.7314 8 22 7.73137 22 7.4V3" {...LINE} />
      <path d="M2.88146 16C4.42458 19.5318 7.94874 22 12.0494 22C17.2347 22 21.4983 18.0533 22 13" {...LINE} />
      <path d="M7.04932 16H2.64932C2.31795 16 2.04932 16.2686 2.04932 16.6V21" {...LINE} />
    </IconoirIcon>
  );
}

export function ShareIos(props: IconoirIconProps) {
  return (
    <IconoirIcon name="share-ios" {...props}>
      <path d="M20 13V19C20 20.1046 19.1046 21 18 21H6C4.89543 21 4 20.1046 4 19V13" {...LINE} />
      <path d="M12 15V3M12 3L8.5 6.5M12 3L15.5 6.5" {...LINE} />
    </IconoirIcon>
  );
}

export function SmartphoneDevice(props: IconoirIconProps) {
  return (
    <IconoirIcon name="smartphone-device" {...props}>
      <path d="M12 16.01L12.01 15.9989" {...LINE} />
      <path
        d="M7 19.4V4.6C7 4.26863 7.26863 4 7.6 4H16.4C16.7314 4 17 4.26863 17 4.6V19.4C17 19.7314 16.7314 20 16.4 20H7.6C7.26863 20 7 19.7314 7 19.4Z"
        {...OUTLINE}
      />
    </IconoirIcon>
  );
}

export function Sort(props: IconoirIconProps) {
  return (
    <IconoirIcon name="sort" {...props}>
      <path d="M10 14H2" {...LINE} />
      <path d="M8 10H2" {...LINE} />
      <path d="M6 6H2" {...LINE} />
      <path d="M12 18H2" {...LINE} />
      <path d="M19 20V4M19 20L22 17M19 20L16 17M19 4L22 7M19 4L16 7" {...LINE} />
    </IconoirIcon>
  );
}

export function SwitchOff(props: IconoirIconProps) {
  return (
    <IconoirIcon name="switch-off" {...props}>
      <path d="M7 13C7.55228 13 8 12.5523 8 12C8 11.4477 7.55228 11 7 11C6.44772 11 6 11.4477 6 12C6 12.5523 6.44772 13 7 13Z" {...DOT} />
      <path d="M17 17H7C4.23858 17 2 14.7614 2 12C2 9.23858 4.23858 7 7 7H17C19.7614 7 22 9.23858 22 12C22 14.7614 19.7614 17 17 17Z" {...OUTLINE} />
    </IconoirIcon>
  );
}

export function Table2Columns(props: IconoirIconProps) {
  return (
    <IconoirIcon name="table-2-columns" {...props}>
      <path
        d="M3 20.4V3.6C3 3.26863 3.26863 3 3.6 3H20.4C20.7314 3 21 3.26863 21 3.6V20.4C21 20.7314 20.7314 21 20.4 21H3.6C3.26863 21 3 20.7314 3 20.4Z"
        {...OUTLINE}
      />
      <path d="M3 16.5H21" {...OUTLINE} />
      <path d="M3 12H21" {...OUTLINE} />
      <path d="M21 7.5H3" {...OUTLINE} />
      <path d="M12 21V3" {...OUTLINE} />
    </IconoirIcon>
  );
}

export function UserPlus(props: IconoirIconProps) {
  return (
    <IconoirIcon name="user-plus" {...props}>
      <path d="M17 10H20M23 10H20M20 10V7M20 10V13" {...LINE} />
      <path d="M1 20V19C1 15.134 4.13401 12 8 12V12C11.866 12 15 15.134 15 19V20" {...LINE} />
      <path d="M8 12C10.2091 12 12 10.2091 12 8C12 5.79086 10.2091 4 8 4C5.79086 4 4 5.79086 4 8C4 10.2091 5.79086 12 8 12Z" {...LINE} />
    </IconoirIcon>
  );
}
