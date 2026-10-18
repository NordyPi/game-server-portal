// Fonts are downloaded at build time and served from this server.
//   body     → Tailwind `font-sans` (default)
//   heading  → Tailwind `font-display`
import { Chakra_Petch, Geist } from "next/font/google";

const body = Geist({ subsets: ["latin"], variable: "--font-body" });
const heading = Chakra_Petch({ subsets: ["latin"], weight: ["500", "700"], variable: "--font-heading" });

export const fontVariables = `${body.variable} ${heading.variable}`;
