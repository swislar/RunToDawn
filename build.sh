#!/bin/bash
# Bundles the split src/ files back into one self-contained HTML file —
# the same shape you'd want for a Claude Artifact, a static-hosting drop,
# or anywhere you'd rather ship one file than a folder.
set -e
cd "$(dirname "$0")"
OUT="${1:-dist/runtodawn.html}"
mkdir -p "$(dirname "$OUT")"
{
cat <<'HEAD'
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>RunToDawn — running analysis from Apple Health</title>
<meta name="description" content="Reads your Apple Health export in the browser, finds your real best efforts, predicts race times and builds a training plan.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@600;700;800&family=IBM+Plex+Mono:wght@400;500&family=Inter:wght@400;500;600;700&display=swap">
<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js"></script>
<style>
HEAD
cat src/style.css
echo '</style>'
echo '</head>'
echo '<body>'
cat src/body.html
echo '<script>'
for f in src/js/00-util.js src/js/10-parse.js src/js/20-metrics.js src/js/25-classify.js src/js/30-charts.js src/js/35-routes.js src/js/40-coach.js src/js/50-views.js src/js/55-coachview.js src/js/60-insights.js src/js/90-boot.js; do
  cat "$f"; echo ''
done
echo '</script>'
echo '</body>'
echo '</html>'
} > "$OUT"
echo "built $(wc -c < "$OUT") bytes -> $OUT"
