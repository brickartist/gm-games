// @flow

const workboxBuild = require("workbox-build");
const build = require("./buildFuncs");

// NOTE: This should be run *AFTER* all your assets are built
const buildSW = async () => {
    console.log("Generating sw.js...");

    const { count, size, warnings } = await workboxBuild.injectManifest({
        swSrc: "src/sw.js",
        swDest: "build/sw.js",
        globDirectory: "build",
        globPatterns: ["**/*.{js,css,html}", "fonts/*.woff", "img/logos/*.png"],
        dontCacheBustUrlsMatching: new RegExp("gen/(ui|worker)-.*.js"),
    });

    warnings.forEach(console.warn);
    console.log(`${count} files will be precached, totaling ${size} bytes.`);

    build.minifyJS("sw.js");
};

buildSW();