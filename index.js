const express = require("express");
const axios = require("axios");
const crypto = require("crypto");
const FormData = require("form-data");
const Flickr = require("flickr-sdk");

const app = express();
app.use(express.json());

const { upload, photosets } = Flickr.createFlickr({
  consumerKey: process.env.FLICKR_API_KEY,
  consumerSecret: process.env.FLICKR_API_SECRET,
  oauthToken: process.env.FLICKR_ACCESS_TOKEN,
  oauthTokenSecret: process.env.FLICKR_ACCESS_SECRET,
});

// Hash Dropbox URL for deduplication
function hashUrl(url) {
  return crypto.createHash("md5").update(url).digest("hex");
}

// Find an existing album by name
async function getOrCreateAlbum(title) {
  const albumList = await photosets.getList();
  const match = albumList.body.photosets.photoset.find(
    (a) => a.title._content === title
  );
  return match ? match.id : null;
}

// Upload photo and tag with machine tag
async function uploadPhoto(photoUrl, title, urlHash) {
  const res = await axios.get(photoUrl, { responseType: "stream" });

  const machineTag = `automation:urlhash=${urlHash}`;

  const uploadResponse = await upload({
    photo: res.data,
    title,
    tags: machineTag,
  });

  return {
    id: uploadResponse.body.photoid._content,
    tag: machineTag,
  };
}

// Create new album
async function createAlbum(title, primaryPhotoId) {
  const response = await photosets.create({
    title,
    primary_photo_id: primaryPhotoId,
  });
  return response.body.photoset.id;
}

// Add photo to album
async function addPhotoToAlbum(photosetId, photoId) {
  await photosets.addPhoto({
    photoset_id: photosetId,
    photo_id: photoId,
  });
}

// Get all automation:urlhash tags from an album
async function getAlbumTags(albumId) {
  const photoList = await photosets.getPhotos({
    photoset_id: albumId,
    extras: "tags",
  });

  const tagsMap = new Map();
  photoList.body.photoset.photo.forEach((p) => {
    p.tags.split(" ").forEach((tag) => {
      if (tag.startsWith("automation:urlhash=")) {
        tagsMap.set(tag, true);
      }
    });
  });

  return tagsMap;
}

// Main upload endpoint
app.post("/", async (req, res) => {
  try {
    const { folderName, imageUrls } = req.body;

    if (!folderName || !Array.isArray(imageUrls) || imageUrls.length === 0) {
      return res.status(400).send("Missing folderName or imageUrls.");
    }

    // Check if album already exists
    let albumId = await getOrCreateAlbum(folderName);
    let existingTags = new Map();

    if (albumId) {
      existingTags = await getAlbumTags(albumId);
    }

    const uploadedPhotoIds = [];

    for (let i = 0; i < imageUrls.length; i++) {
      const url = imageUrls[i];
      const urlHash = hashUrl(url);
      const machineTag = `automation:urlhash=${urlHash}`;

      if (existingTags.has(machineTag)) {
        console.log(`Skipping duplicate image: ${url}`);
        continue;
      }

      const { id: photoId } = await uploadPhoto(url, `${folderName} – Photo ${i + 1}`, urlHash);
      uploadedPhotoIds.push(photoId);

      if (!albumId && uploadedPhotoIds.length === 1) {
        albumId = await createAlbum(folderName, photoId);
        existingTags = new Map(); // reset since new album
      } else {
        await addPhotoToAlbum(albumId, photoId);
      }
    }

    res.status(200).send({
      status: "Upload complete",
      albumId,
      photos: uploadedPhotoIds,
    });

  } catch (err) {
    console.error("Upload error:", err?.response?.data || err.message);
    res.status(500).send("Upload failed.");
  }
});

app.listen(3000, () => {
  console.log("Uploader live on port 3000");
});
