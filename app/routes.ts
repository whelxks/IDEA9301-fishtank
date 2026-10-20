import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("aquarium", "routes/aquarium/aquarium.tsx"),
  route("color", "routes/color/color-fish.tsx"),
  route(
    "endangered-aquarium",
    "routes/endangered-aquarium/endangered-aquarium.tsx",
  ),
] satisfies RouteConfig;
