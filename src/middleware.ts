import { defineMiddleware } from "astro:middleware";
import { errorBoundary } from "@/lib/error-boundary";

export const onRequest = defineMiddleware((context, next) => errorBoundary(context, next));
