import type { Status } from "../api";

export const isWorking = (status: Status) => status !== "done" && status !== "failed";
