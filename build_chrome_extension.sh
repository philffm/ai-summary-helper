# Build the chrome extension

# copy files from assets to chrome-extension
# - translations.json
# - compatible-tools.json
cp -f translations.json chrome-extension/

# Read the table from the Compatible Tools section of readme.md
awk '/# Compatible Tools/,/Tools that are compatible with AI Summary Helper./ {print}' readme.md | \
grep -Ev '# Compatible Tools|Tools that are compatible with AI Summary Helper.|---' | \
awk -F'|' '{
    # Trim leading/trailing whitespace
    name=gensub(/^ +| +$/, "", "g", $1);
    description=gensub(/^ +| +$/, "", "g", $2);
    url=gensub(/^ +| +$/, "", "g", $3);
    
    # Print JSON formatted entries
    if (name && description && url) {
        printf("{\"name\": \"%s\", \"description\": \"%s\", \"url\": \"%s\"},\n", name, description, url)
    }
}' | sed '$ s/,$//' > chrome-extension/compatible-tools.json


# increment the version number in manifest.json
VERSION=$(jq -r '.version' chrome-extension/manifest.json)
NEW_VERSION=$(echo $VERSION | awk -F. '{$NF = $NF + 1;} 1' | sed 's/ /./g')
sed -i '' "s/$VERSION/$NEW_VERSION/" chrome-extension/manifest.json


# zip the chrome-extension folder with the new version number - if the zip file already exists, remove it
ZIP_FILE="chrome-extension-$NEW_VERSION.zip"
if [ -f $ZIP_FILE ]; then
  rm $ZIP_FILE
fi
zip -r $ZIP_FILE chrome-extension/


echo "Chrome extension built: $ZIP_FILE"
