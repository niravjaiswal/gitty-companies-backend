import { describe, expect, it } from "vitest";
import { loadSkeleton } from "../loader.js";

describe("loadSkeleton", () => {
  it("throws for a non-existent skeleton id", async () => {
    await expect(loadSkeleton("does-not-exist")).rejects.toThrow(
      /skeleton not found.*does-not-exist/i,
    );
  });

  it("loads the pulseboard-launch-sprint skeleton", async () => {
    const loaded = await loadSkeleton("pulseboard-launch-sprint");

    expect(loaded.skeleton.name).toBe("pulseboard-launch-sprint");
    expect(loaded.skeleton.language).toBe("typescript");
    expect(loaded.skeleton.pattern).toBe("react-spa");
    expect(loaded.skeleton.assessment_copy?.title).toBe(
      "Pulseboard Launch Sprint",
    );

    expect(loaded.manifest.files.length).toBe(15);
    expect(loaded.manifest.files.find((f) => f.path === "src/App.tsx")?.role).toBe(
      "candidate",
    );

    // All manifest files should be loaded
    for (const entry of loaded.manifest.files) {
      expect(loaded.files[entry.path]).toBeDefined();
      expect(loaded.files[entry.path].length).toBeGreaterThan(0);
    }
  });

  it("loads the rest-api-express skeleton", async () => {
    const loaded = await loadSkeleton("rest-api-express");

    expect(loaded.skeleton.name).toBe("rest-api-express");
    expect(loaded.skeleton.language).toBe("typescript");
    expect(loaded.skeleton.pattern).toBe("rest-api");

    expect(loaded.manifest.files.length).toBe(8);

    for (const entry of loaded.manifest.files) {
      expect(loaded.files[entry.path]).toBeDefined();
      expect(loaded.files[entry.path].length).toBeGreaterThan(0);
    }
  });

  it("returns files keyed by manifest path", async () => {
    const loaded = await loadSkeleton("pulseboard-launch-sprint");

    expect(loaded.files["package.json"]).toContain("pulseboard-launch-sprint");
    expect(loaded.files["src/main.tsx"]).toContain("ReactDOM");
    expect(loaded.files["src/App.tsx"]).toContain("LaunchComposer");
  });
});
