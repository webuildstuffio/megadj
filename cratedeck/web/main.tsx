import { render } from "preact";
import { App } from "./App";
import "./styles.css";
import "./help.css";
import "./jobs.css";
import "./fleet-tabs.css";
import "./products.css";

render(<App />, document.getElementById("app")!);
