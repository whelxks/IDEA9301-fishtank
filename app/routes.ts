import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("aquarium", "routes/aquarium/aquarium.tsx"),
  route("color/completed", "routes/color/completed.tsx"),
  route("color/nfc-collect", "routes/color/nfc-collect.tsx"),
  route("color/:fish?", "routes/color/color-fish.tsx"),
  route(
    "endangered-aquarium",
    "routes/endangered-aquarium/endangered-aquarium.tsx",
  ),
  route(
    "nfc-12345",
    "routes/nfc-12345/nfc-12345.tsx",
  ),
] satisfies RouteConfig;
