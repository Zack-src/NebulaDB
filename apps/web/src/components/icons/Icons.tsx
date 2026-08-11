import type { CSSProperties, FunctionComponent, SVGProps } from "react";

import AlertTriangleSvg from "@/assets/icons/alert-triangle.svg?react";
import ArchiveSvg from "@/assets/icons/archive.svg?react";
import AsteriskSvg from "@/assets/icons/asterisk.svg?react";
import CheckSvg from "@/assets/icons/check.svg?react";
import CheckCircleSvg from "@/assets/icons/check-circle.svg?react";
import ChevronLeftSvg from "@/assets/icons/chevron-left.svg?react";
import ChevronRightSvg from "@/assets/icons/chevron-right.svg?react";
import ClockSvg from "@/assets/icons/clock.svg?react";
import CloseSvg from "@/assets/icons/close.svg?react";
import CodeSvg from "@/assets/icons/code.svg?react";
import CommentSvg from "@/assets/icons/comment.svg?react";
import CreditCardSvg from "@/assets/icons/credit-card.svg?react";
import DiamondSvg from "@/assets/icons/diamond.svg?react";
import DownloadSvg from "@/assets/icons/download.svg?react";
import FolderSvg from "@/assets/icons/folder.svg?react";
import FrameSvg from "@/assets/icons/frame.svg?react";
import IncrementSvg from "@/assets/icons/increment.svg?react";
import InfoSvg from "@/assets/icons/info.svg?react";
import KeySvg from "@/assets/icons/key.svg?react";
import LayersSvg from "@/assets/icons/layers.svg?react";
import LayoutGridSvg from "@/assets/icons/layout-grid.svg?react";
import LinkSvg from "@/assets/icons/link.svg?react";
import LogOutSvg from "@/assets/icons/log-out.svg?react";
import LogoMarkSvg from "@/assets/icons/logo-mark.svg?react";
import MinimapSvg from "@/assets/icons/minimap.svg?react";
import NoteSvg from "@/assets/icons/note.svg?react";
import PaletteSvg from "@/assets/icons/palette.svg?react";
import PencilSvg from "@/assets/icons/pencil.svg?react";
import PlusSvg from "@/assets/icons/plus.svg?react";
import PuzzleSvg from "@/assets/icons/puzzle.svg?react";
import RedoSvg from "@/assets/icons/redo.svg?react";
import RestoreSvg from "@/assets/icons/restore.svg?react";
import SearchSvg from "@/assets/icons/search.svg?react";
import SettingsSvg from "@/assets/icons/settings.svg?react";
import SlidersSvg from "@/assets/icons/sliders.svg?react";
import SparklesSvg from "@/assets/icons/sparkles.svg?react";
import TableSvg from "@/assets/icons/table.svg?react";
import TagSvg from "@/assets/icons/tag.svg?react";
import TrashSvg from "@/assets/icons/trash.svg?react";
import UndoSvg from "@/assets/icons/undo.svg?react";
import UploadSvg from "@/assets/icons/upload.svg?react";
import UserSvg from "@/assets/icons/user.svg?react";
import UsersSvg from "@/assets/icons/users.svg?react";

/**
 * Icon set — every icon is a real `.svg` file under `./icons/`, imported as a
 * React component via `vite-plugin-svgr`'s `?react` suffix. One wrapper per
 * icon carries its own default `size`, so call sites (`<PlusIcon size={13} />`)
 * stay unchanged. No icon-library dependency: keeps the bundle self-contained,
 * consistent with the project's self-hosted stance. Stroke-based, currentColor
 * — style via CSS `color`.
 */

export interface IconProps {
  size?: number;
  style?: CSSProperties;
  className?: string;
}

type SvgComponent = FunctionComponent<SVGProps<SVGSVGElement>>;

function wrapSvgAsIcon(Svg: SvgComponent, defaultSize: number) {
  return function Icon({ size = defaultSize, style, className }: IconProps) {
    return <Svg width={size} height={size} style={style} className={className} />;
  };
}

export const AlertTriangleIcon = wrapSvgAsIcon(AlertTriangleSvg, 14);
export const ArchiveIcon = wrapSvgAsIcon(ArchiveSvg, 13);
export const AsteriskIcon = wrapSvgAsIcon(AsteriskSvg, 11);
export const CheckIcon = wrapSvgAsIcon(CheckSvg, 16);
export const CheckCircleIcon = wrapSvgAsIcon(CheckCircleSvg, 16);
export const ChevronLeftIcon = wrapSvgAsIcon(ChevronLeftSvg, 16);
export const ChevronRightIcon = wrapSvgAsIcon(ChevronRightSvg, 16);
export const ClockIcon = wrapSvgAsIcon(ClockSvg, 15);
export const CloseIcon = wrapSvgAsIcon(CloseSvg, 16);
export const CodeIcon = wrapSvgAsIcon(CodeSvg, 15);
export const CommentIcon = wrapSvgAsIcon(CommentSvg, 13);
export const CreditCardIcon = wrapSvgAsIcon(CreditCardSvg, 16);
export const DiamondIcon = wrapSvgAsIcon(DiamondSvg, 10);
export const DownloadIcon = wrapSvgAsIcon(DownloadSvg, 15);
export const FolderIcon = wrapSvgAsIcon(FolderSvg, 18);
export const FrameIcon = wrapSvgAsIcon(FrameSvg, 15);
export const IncrementIcon = wrapSvgAsIcon(IncrementSvg, 11);
export const InfoIcon = wrapSvgAsIcon(InfoSvg, 16);
export const KeyIcon = wrapSvgAsIcon(KeySvg, 12);
export const LayersIcon = wrapSvgAsIcon(LayersSvg, 16);
export const LayoutGridIcon = wrapSvgAsIcon(LayoutGridSvg, 15);
export const LinkIcon = wrapSvgAsIcon(LinkSvg, 10);
export const LogOutIcon = wrapSvgAsIcon(LogOutSvg, 14);
export const LogoMarkIcon = wrapSvgAsIcon(LogoMarkSvg, 15);
export const MinimapIcon = wrapSvgAsIcon(MinimapSvg, 14);
export const NoteIcon = wrapSvgAsIcon(NoteSvg, 15);
export const PaletteIcon = wrapSvgAsIcon(PaletteSvg, 16);
export const PencilIcon = wrapSvgAsIcon(PencilSvg, 13);
export const PlusIcon = wrapSvgAsIcon(PlusSvg, 16);
export const PuzzleIcon = wrapSvgAsIcon(PuzzleSvg, 14);
export const RedoIcon = wrapSvgAsIcon(RedoSvg, 15);
export const RestoreIcon = wrapSvgAsIcon(RestoreSvg, 13);
export const SearchIcon = wrapSvgAsIcon(SearchSvg, 14);
export const SettingsIcon = wrapSvgAsIcon(SettingsSvg, 13);
export const SlidersIcon = wrapSvgAsIcon(SlidersSvg, 16);
export const SparklesIcon = wrapSvgAsIcon(SparklesSvg, 16);
export const TableIcon = wrapSvgAsIcon(TableSvg, 15);
export const TagIcon = wrapSvgAsIcon(TagSvg, 12);
export const TrashIcon = wrapSvgAsIcon(TrashSvg, 13);
export const UndoIcon = wrapSvgAsIcon(UndoSvg, 15);
export const UploadIcon = wrapSvgAsIcon(UploadSvg, 15);
export const UserIcon = wrapSvgAsIcon(UserSvg, 16);
export const UsersIcon = wrapSvgAsIcon(UsersSvg, 14);
