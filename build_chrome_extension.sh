# Build the chrome extension

# copy files from assets to chrome-extension
# - translations.json
# - compatible-tools.json
cp -f translations.json chrome-extension/

# Read the table from the Compatible Tools section of readme.md
awk '/Name \| Description \| URL/{flag=1; next} /--- \| --- \| ---/{next} /^$/{flag=0} flag' readme.md > table.txt

awk 'BEGIN{
  FS="|";
  print "["
}
{
  gsub(/^[ \t]+|[ \t]+$/, "", $1);
  gsub(/^[ \t]+|[ \t]+$/, "", $2);
  gsub(/^[ \t]+|[ \t]+$/, "", $3);
  names[NR]=$1;
  descriptions[NR]=$2;
  urls[NR]=$3;
}
END{
  for(i=1;i<=NR;i++){
    printf "  {\n    \"Name\": \"%s\",\n    \"Description\": \"%s\",\n    \"URL\": \"%s\"\n  }", names[i], descriptions[i], urls[i];
    if(i<NR) { print "," } else { print "" }
    print ""
  }
  print "]"
}' table.txt > compatible-tools.json

# copy compatible-tools.json to chrome-extension
cp -f compatible-tools.json chrome-extension/

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
