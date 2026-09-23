import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("aquarium", "routes/aquarium.tsx"),
  route("color", "routes/color-fish.tsx"),
] satisfies RouteConfig;