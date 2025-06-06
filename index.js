import express from "express";
import axios from "axios";
import FormData from "form-data";
import { Flickr } from "flickr-sdk";

const app = express();
app.use(express.json());

// Setup Flickr OAuth plugin
const flickr = new Flickr(Flickr.OAuth.createPlugin(
  process.env.FLICKR_API_KEY,
  process.env.FLICKR_API_SECRET,
  process.env.FLICKR_ACCESS_TOKEN,
  process.env.FLICKR_ACCESS_SECRET
));

// Uploads a single photo from a public URL
async function uploadPhoto(photoUrl, title = "Untitled") {
  const res = await axios.get(photoUrl, { responseType: "stream" });

  const uploadResponse = await flickr.upload({
    photo: res.data,
    title,
  });

  return uploadResponse.body.photoid._content;
}

// Creates a new album (photoset) with the first uploaded photo
async function createAlbum(title, primaryPhotoId) {
  const response = await flickr.photosets.create({
    title,
    primary_photo_id: primaryPhotoId,
  });

  return response.body.photoset.id;
}

// Adds a photo to an existing album
async function addPhotoToAlbum(photosetId, photoId) {
  await flickr.photosets.addPhoto({
    photoset_id: photosetId,
    photo_id: photoId,
  });
}

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
