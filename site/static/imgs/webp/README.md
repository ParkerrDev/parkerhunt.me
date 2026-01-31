to make images multiple sizes first get a .webp from tinypng, then use ffmpeg:

img="input.webp"
base=$(basename "$img" .webp)
for size in 123 246 369 492 615; do
  ffmpeg -i "$img" -vf "scale=$size:-1" "${base}-${size}.webp"
done   
