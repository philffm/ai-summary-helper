#!/bin/bash

# Build the chrome extension

# copy files from assets to chrome-extension
cp -f translations.json chrome-extension/

# Read the table from the Compatible Tools section of readme.md (Root)
awk '/Name \| Description \| URL/{flag=1; next} /--- \| --- \| ---/{next} /^$/{flag=0} flag' readme.md > table.txt

awk 'BEGIN{ FS="|"; print "[" }
{
  gsub(/^[ \t]+|[ \t]+$/, "", $1); gsub(/^[ \t]+|[ \t]+$/, "", $2); gsub(/^[ \t]+|[ \t]+$/, "", $3);
  names[NR]=$1; descriptions[NR]=$2; urls[NR]=$3;
}
END{
  for(i=1;i<=NR;i++){
    printf "  {\n    \"Name\": \"%s\",\n    \"Description\": \"%s\",\n    \"URL\": \"%s\"\n  }", names[i], descriptions[i], urls[i];
    if(i<NR) { print "," } else { print "" }
    print ""
  }
  print "]"
}' table.txt > compatible-tools.json

cp -f compatible-tools.json chrome-extension/

# increment the version number in manifest.json and current_version.json
VERSION=$(jq -r '.version' chrome-extension/manifest.json)
NEW_VERSION=$(echo $VERSION | awk -F. '{$NF = $NF + 1;} 1' | sed 's/ /./g')
sed -i '' "s/$VERSION/$NEW_VERSION/" chrome-extension/manifest.json

jq ".version = \"$NEW_VERSION\"" current_version.json > current_version.json.tmp && mv current_version.json.tmp current_version.json

# inject version into popup.html
sed -i '' "s|<span id=\"versionNumber\">[^<]*</span>|<span id=\"versionNumber\">$NEW_VERSION</span>|" chrome-extension/popup.html

# zip the chrome-extension folder
ZIP_FILE="chrome-extension-$NEW_VERSION.zip"
[ -f "$ZIP_FILE" ] && rm "$ZIP_FILE"
zip -r "$ZIP_FILE" chrome-extension/

echo "Chrome extension built: $ZIP_FILE"