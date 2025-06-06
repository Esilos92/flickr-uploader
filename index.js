const express = require("express");
const axios = require("axios");
const FormData = require("form-data");
const Flickr = require("flickr-sdk");

const app = express();
app.use(express.json());

// Correct auth method from current docs
const { upload, photosets } = Flickr.createFlickr({
  consumerKey: process.env.FLICKR_API_KEY,
  consumerSecret: process.env.FLICKR_API_SECRET,
  oauthToken: process.env.FLICKR_ACCESS_TOKEN,
  oauthTokenSecret: process.env.FLICKR_ACCESS_SECRET,
});

// Upload photo from URL
async function uploadPhoto(photoUrl, title = "Untitled") {
  const res = await axios.get(photoUrl, { responseType: "stream" });

  const uploadResponse = await upload({
    photo: res.data,
    title,
  });

  return uploadResponse.body.photoid._content;
}

// Create album
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

// Main upload endpoint
app.post("/", async (req, res) => {
  try {
    const { folderName, imageUrls } = req.body;

    if (!folderName || !Array.isArray(imageUrls) || imageUrls.length === 0) {
      return res.status(400).send("Missing folderName or imageUrls.");
    }

    const uploadedPhotoIds = [];
    for (let i = 0; i < imageUrls.length; i++) {
      const photoId = await uploadPhoto(imageUrls[i], `${folderName} – Photo ${i + 1}`);
      uploadedPhotoIds.push(photoId);
    }

    const albumId = await createAlbum(folderName, uploadedPhotoIds[0]);

    for (let i = 1; i < uploadedPhotoIds.length; i++) {
      await addPhotoToAlbum(albumId, uploadedPhotoIds[i]);
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
