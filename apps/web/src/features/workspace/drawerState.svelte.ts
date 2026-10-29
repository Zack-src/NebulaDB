import { readBoolean, readNumberInRange, writeBoolean, writeString } from "@/utils/storage";

const OPEN_KEY = "nebuladb.deploymentDrawer.open";
const WIDTH_KEY = "nebuladb.deploymentDrawer.width";

interface DeploymentDrawerInput {
  /** Whether this user may see deployments at all (`deploy` or `administrator`). */
  allowed: () => boolean;
  /** Whether the drawer's place (the schema tab) is showing. */
  visible: () => boolean;
}

/**
 * The deployment panel beside the diagram, like the SQL drawer: the plan, its conflicts and the SQL stay
 * on screen while the schema is edited, so a conflict can be fixed where it is reported without leaving
 * the panel and starting the analysis again. Open / closed and width are remembered per browser.
 *
 * `mounted` turns true the first time the drawer opens and stays true: closing it only hides it, so the
 * analysis already made (which can take long against a remote database) is not thrown away.
 */
export class DeploymentDrawerState {
  static readonly MIN_WIDTH = 360;
  static readonly MAX_WIDTH = 1100;

  open = $state(readBoolean(OPEN_KEY, false));
  width = $state(readNumberInRange(WIDTH_KEY, DeploymentDrawerState.MIN_WIDTH, DeploymentDrawerState.MAX_WIDTH, 520));
  mounted = $state(false);

  constructor(private readonly input: DeploymentDrawerInput) {
    $effect(() => {
      if (this.open && this.usable) this.mounted = true;
    });
  }

  /** This user may deploy, so the drawer is offered. */
  get usable(): boolean {
    return this.input.allowed();
  }

  /** The drawer shows: opened, allowed, and on the tab it lives in. */
  get showing(): boolean {
    return this.open && this.usable && this.input.visible();
  }

  setOpen = (open: boolean): void => {
    this.open = open;
    writeBoolean(OPEN_KEY, open);
  };

  rememberWidth = (width: number): void => writeString(WIDTH_KEY, String(width));
}
