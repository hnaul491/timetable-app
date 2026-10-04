import type { Messages } from "../types";
import { board } from "./board";
import { calendar } from "./calendar";
import { common } from "./common";
import { errors } from "./errors";
import { event } from "./event";
import { google } from "./google";
import { nav } from "./nav";
import { review } from "./review";
import { settings } from "./settings";
import { subjects } from "./subjects";

export const vi: Messages = { common, errors, nav, calendar, event, board, subjects, review, settings, google };
