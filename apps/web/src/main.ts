import { mount } from "svelte";
import "@/styles/index.css";
import "@xyflow/svelte/dist/style.css";
import Root from "@/app/Root.svelte";

mount(Root, { target: document.getElementById("root")! });
