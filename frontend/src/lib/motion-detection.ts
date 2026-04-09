export interface MotionAnalysis {
  changedPixels: number;
  score: number;
  detected: boolean;
}

export interface MotionAnalysisOptions {
  pixelDifferenceThreshold?: number;
  motionScoreThreshold?: number;
}

const defaultOptions: Required<MotionAnalysisOptions> = {
  pixelDifferenceThreshold: 32,
  motionScoreThreshold: 0.018,
};

export function analyzeMotionFrame(
  previousFrame: Uint8ClampedArray | null,
  currentFrame: Uint8ClampedArray,
  options: MotionAnalysisOptions = {},
): MotionAnalysis | null {
  if (!previousFrame || previousFrame.length !== currentFrame.length) {
    return null;
  }

  const { pixelDifferenceThreshold, motionScoreThreshold } = {
    ...defaultOptions,
    ...options,
  };

  let changedPixels = 0;

  for (let index = 0; index < currentFrame.length; index += 4) {
    const currentRed = currentFrame[index] ?? 0;
    const previousRed = previousFrame[index] ?? 0;
    const currentGreen = currentFrame[index + 1] ?? 0;
    const previousGreen = previousFrame[index + 1] ?? 0;
    const currentBlue = currentFrame[index + 2] ?? 0;
    const previousBlue = previousFrame[index + 2] ?? 0;

    const redDifference = Math.abs(currentRed - previousRed);
    const greenDifference = Math.abs(
      currentGreen - previousGreen,
    );
    const blueDifference = Math.abs(
      currentBlue - previousBlue,
    );

    const averageDifference =
      (redDifference + greenDifference + blueDifference) / 3;

    if (averageDifference >= pixelDifferenceThreshold) {
      changedPixels += 1;
    }
  }

  const totalPixels = currentFrame.length / 4;
  const score = totalPixels > 0 ? changedPixels / totalPixels : 0;

  return {
    changedPixels,
    score,
    detected: score >= motionScoreThreshold,
  };
}