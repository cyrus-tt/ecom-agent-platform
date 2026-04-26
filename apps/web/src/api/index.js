/**
 * V3 起 page 端唯一推荐入口：
 *
 *   import { reportsApi, errorMessage } from "../api";
 *   const data = await reportsApi.getDailyReportRows({ ... });
 *
 * 见 docs/adr/0016-frontend-api-layer.md。
 */
import * as authApi from "./auth";
import * as adminApi from "./admin";
import * as reportsApi from "./reports";
import * as arrivalApi from "./arrival";
import * as notesApi from "./notes";
import * as agentApi from "./agent";
import * as dispatchApi from "./dispatch";

export { authApi, adminApi, reportsApi, arrivalApi, notesApi, agentApi, dispatchApi };
export { default as http, errorMessage } from "./http";
