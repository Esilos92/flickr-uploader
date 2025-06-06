const express = require("express");
const axios = require("axios");
const crypto = require("crypto");
const FormData = require("form-data");
const { createFlickr } = require("flickr-sdk");

const app = express();
app.use(express.json());

// ✅ Correct usage per official SDK documentation
const flickr = createFlickr({
  consumerKey: process.env.FLICKR_API_KEY,
  consumerSecret: process.env.FLICKR_API_SECRET,
  oauthToken: process.env.FLICKR_ACCESS_TOKEN,
  oauthTokenSecret: process.env.FLICKR_ACCESS_SECRET,
});

const { upload, photosets } = flickr;

// Generate a hash of the Dropbox URL for deduplication
function hashUrl(url) {
  return crypto.createHash("md5").update(url).digest("hex");
}

// Find an existing album by title, or return null
async function getOrCreateAlbum(title) {
  const albumList = await photosets.getList();
  const match = albumList.body.photosets.photoset.find(
    (a) => a.title._content === title
  );
  return match ? match.id : null;
}

// Upload a single photo with metadata and deduplication tag
async function uploadPhoto({ url, title, description }, urlHash) {
  const res = await axios.get(url, { responseType: "stream" });
  const machineTag = `automation:urlhash=${urlHash}`;

  const uploadResponse = await upload({
    photo: res.data,
    title: title || "Untitled",
    description: description || "",
    tags: machineTag,
  });

  return {
    id: uploadResponse.body.photoid._content,
    tag: machineTag,
  };
}

// Create a new album with a primary photo
async function createAlbum(title, primaryPhotoId) {
  const response = await photosets.create({
    title,
    primary_photo_id: primaryPhotoId,
  });
  return response.body.photoset.id;
}

// Add additional photos to an album
async function addPhotoToAlbum(photosetId, photoId) {
  await photosets.addPhoto({
    photoset_id: photosetId,
    photo_id: photoId,
  });
}

// Retrieve all deduplication tags already in the album
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
    const { albumTitle, images } = req.body;

    if (!albumTitle || !Array.isArray(images) || images.length === 0) {
      return res.status(400).send("Missing albumTitle or images.");
    }

    let albumId = await getOrCreateAlbum(albumTitle);
    let existingTags = new Map();

    if (albumId) {
      existingTags = await getAlbumTags(albumId);
    }

    const uploadedPhotoIds = [];

    for (let i = 0; i < images.length; i++) {
      const { url, title, description } = images[i];
      const urlHash = hashUrl(url);
      const machineTag = `automation:urlhash=${urlHash}`;

      if (existingTags.has(machineTag)) {
        console.log(`Skipping duplicate image: ${url}`);
        continue;
      }

      const { id: photoId } = await uploadPhoto({ url, title, description }, urlHash);
      uploadedPhotoIds.push(photoId);

      if (!albumId && uploadedPhotoIds.length === 1) {
        albumId = await createAlbum(albumTitle, photoId);
        existingTags = new Map(); // start fresh since album is new
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

// Optional health check endpoint
app.get("/", (_, res) => {
  res.status(200).send("Flickr uploader is running.");
});

app.listen(3000, () => {
  console.log("Uploader live on port 3000");
});
