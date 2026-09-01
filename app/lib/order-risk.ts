export function riskLevelFromRecommendation(
  recommendation: string | null | undefined,
): string | null {
  switch (recommendation) {
    case "ACCEPT":
      return "LOW";
    case "INVESTIGATE":
      return "MEDIUM";
    case "CANCEL":
      return "HIGH";
    default:
      return null;
  }
}
