// main.tsx — entry: mount App, load stylesheets in cascade order (tokens
// → base → shell → rail → canvas → pages → product chrome → help/jobs).
import { render } from "preact";
import { App } from "./App";
import "../styles/tokens.css";
import "../styles/base.css";
import "../styles/shell.css";
import "../styles/rail.css";
import "../styles/canvas.css";
import "../styles/pages.css";
import "../styles/products.css";
import "../styles/fleet-tabs.css";
import "../styles/data.css";
import "../styles/help.css";
import "../styles/jobs.css";
import "../styles/intake.css";

render(<App />, document.getElementById("app")!);
