import { defineIcon, type IconDefinition } from "./iconDefinition";

import alertTriangleSvg from "@/assets/icons/alert-triangle.svg?raw";
import archiveSvg from "@/assets/icons/archive.svg?raw";
import asteriskSvg from "@/assets/icons/asterisk.svg?raw";
import checkSvg from "@/assets/icons/check.svg?raw";
import checkCircleSvg from "@/assets/icons/check-circle.svg?raw";
import chevronLeftSvg from "@/assets/icons/chevron-left.svg?raw";
import chevronRightSvg from "@/assets/icons/chevron-right.svg?raw";
import clockSvg from "@/assets/icons/clock.svg?raw";
import closeSvg from "@/assets/icons/close.svg?raw";
import codeSvg from "@/assets/icons/code.svg?raw";
import commentSvg from "@/assets/icons/comment.svg?raw";
import creditCardSvg from "@/assets/icons/credit-card.svg?raw";
import databaseSvg from "@/assets/icons/database.svg?raw";
import diamondSvg from "@/assets/icons/diamond.svg?raw";
import downloadSvg from "@/assets/icons/download.svg?raw";
import folderSvg from "@/assets/icons/folder.svg?raw";
import frameSvg from "@/assets/icons/frame.svg?raw";
import gripVerticalSvg from "@/assets/icons/grip-vertical.svg?raw";
import incrementSvg from "@/assets/icons/increment.svg?raw";
import infoSvg from "@/assets/icons/info.svg?raw";
import keySvg from "@/assets/icons/key.svg?raw";
import layersSvg from "@/assets/icons/layers.svg?raw";
import layoutGridSvg from "@/assets/icons/layout-grid.svg?raw";
import linkSvg from "@/assets/icons/link.svg?raw";
import logOutSvg from "@/assets/icons/log-out.svg?raw";
import logoMarkSvg from "@/assets/icons/logo-mark.svg?raw";
import minimapSvg from "@/assets/icons/minimap.svg?raw";
import noteSvg from "@/assets/icons/note.svg?raw";
import paletteSvg from "@/assets/icons/palette.svg?raw";
import pencilSvg from "@/assets/icons/pencil.svg?raw";
import plusSvg from "@/assets/icons/plus.svg?raw";
import puzzleSvg from "@/assets/icons/puzzle.svg?raw";
import redoSvg from "@/assets/icons/redo.svg?raw";
import restoreSvg from "@/assets/icons/restore.svg?raw";
import searchSvg from "@/assets/icons/search.svg?raw";
import settingsSvg from "@/assets/icons/settings.svg?raw";
import slidersSvg from "@/assets/icons/sliders.svg?raw";
import sparklesSvg from "@/assets/icons/sparkles.svg?raw";
import swapHorizontalSvg from "@/assets/icons/swap-horizontal.svg?raw";
import tableSvg from "@/assets/icons/table.svg?raw";
import tagSvg from "@/assets/icons/tag.svg?raw";
import trashSvg from "@/assets/icons/trash.svg?raw";
import undoSvg from "@/assets/icons/undo.svg?raw";
import uploadSvg from "@/assets/icons/upload.svg?raw";
import userSvg from "@/assets/icons/user.svg?raw";
import usersSvg from "@/assets/icons/users.svg?raw";

/**
 * Icon set — every icon is a real `.svg` file under `assets/icons/`, imported
 * as raw markup (`?raw`) and rendered by `Icon.svelte`. Each definition
 * carries its own default `size`, so call sites (`<Icon icon={PlusIcon}
 * size={13} />`) read the same as before. No icon-library dependency: keeps
 * the bundle self-contained, consistent with the project's self-hosted
 * stance. Stroke-based, currentColor — style via CSS `color`.
 */
export const AlertTriangleIcon: IconDefinition = defineIcon(alertTriangleSvg, 14);
export const ArchiveIcon: IconDefinition = defineIcon(archiveSvg, 13);
export const AsteriskIcon: IconDefinition = defineIcon(asteriskSvg, 11);
export const CheckIcon: IconDefinition = defineIcon(checkSvg, 16);
export const CheckCircleIcon: IconDefinition = defineIcon(checkCircleSvg, 16);
export const ChevronLeftIcon: IconDefinition = defineIcon(chevronLeftSvg, 16);
export const ChevronRightIcon: IconDefinition = defineIcon(chevronRightSvg, 16);
export const ClockIcon: IconDefinition = defineIcon(clockSvg, 15);
export const CloseIcon: IconDefinition = defineIcon(closeSvg, 16);
export const CodeIcon: IconDefinition = defineIcon(codeSvg, 15);
export const CommentIcon: IconDefinition = defineIcon(commentSvg, 13);
export const CreditCardIcon: IconDefinition = defineIcon(creditCardSvg, 16);
export const DatabaseIcon: IconDefinition = defineIcon(databaseSvg, 15);
export const DiamondIcon: IconDefinition = defineIcon(diamondSvg, 10);
export const DownloadIcon: IconDefinition = defineIcon(downloadSvg, 15);
export const FolderIcon: IconDefinition = defineIcon(folderSvg, 18);
export const FrameIcon: IconDefinition = defineIcon(frameSvg, 15);
export const GripVerticalIcon: IconDefinition = defineIcon(gripVerticalSvg, 12);
export const IncrementIcon: IconDefinition = defineIcon(incrementSvg, 11);
export const InfoIcon: IconDefinition = defineIcon(infoSvg, 16);
export const KeyIcon: IconDefinition = defineIcon(keySvg, 12);
export const LayersIcon: IconDefinition = defineIcon(layersSvg, 16);
export const LayoutGridIcon: IconDefinition = defineIcon(layoutGridSvg, 15);
export const LinkIcon: IconDefinition = defineIcon(linkSvg, 10);
export const LogOutIcon: IconDefinition = defineIcon(logOutSvg, 14);
export const LogoMarkIcon: IconDefinition = defineIcon(logoMarkSvg, 15);
export const MinimapIcon: IconDefinition = defineIcon(minimapSvg, 14);
export const NoteIcon: IconDefinition = defineIcon(noteSvg, 15);
export const PaletteIcon: IconDefinition = defineIcon(paletteSvg, 16);
export const PencilIcon: IconDefinition = defineIcon(pencilSvg, 13);
export const PlusIcon: IconDefinition = defineIcon(plusSvg, 16);
export const PuzzleIcon: IconDefinition = defineIcon(puzzleSvg, 14);
export const RedoIcon: IconDefinition = defineIcon(redoSvg, 15);
export const RestoreIcon: IconDefinition = defineIcon(restoreSvg, 13);
export const SearchIcon: IconDefinition = defineIcon(searchSvg, 14);
export const SettingsIcon: IconDefinition = defineIcon(settingsSvg, 13);
export const SlidersIcon: IconDefinition = defineIcon(slidersSvg, 16);
export const SparklesIcon: IconDefinition = defineIcon(sparklesSvg, 16);
export const SwapHorizontalIcon: IconDefinition = defineIcon(swapHorizontalSvg, 13);
export const TableIcon: IconDefinition = defineIcon(tableSvg, 15);
export const TagIcon: IconDefinition = defineIcon(tagSvg, 12);
export const TrashIcon: IconDefinition = defineIcon(trashSvg, 13);
export const UndoIcon: IconDefinition = defineIcon(undoSvg, 15);
export const UploadIcon: IconDefinition = defineIcon(uploadSvg, 15);
export const UserIcon: IconDefinition = defineIcon(userSvg, 16);
export const UsersIcon: IconDefinition = defineIcon(usersSvg, 14);
