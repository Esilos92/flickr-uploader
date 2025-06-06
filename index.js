// index.js — Flickr SDK-based uploader with album checking

import express from "express";
import { Flickr } from "flickr-sdk";
import axios from "axios";
import path from "path";
import FormData from "form-data";

const app = express();
app.use(express.json());

app.get("/", (req, res) => {
  res.send("✅ Flickr Upload API is running.");
});

const flickr = new Flickr(
  Flickr.OAuth.createPlugin(
    process.env.FLICKR_API_KEY,
    process.env.FLICKR_API_SECRET,
    process.env.FLICKR_ACCESS_TOKEN,
    process.env.FLICKR_ACCESS_SECRET
  )
);

async function getAlbumIdByTitle(title) {
  const res = await flickr.photosets.getList({ user_id: "me" });
  const albums = res.body.photosets.photoset;
  const match = albums.find((a) => a.title._content === title);
  return match ? match.id : null;
}

async function createAlbum(title, primaryPhotoId) {
  const res = await flickr.photosets.create({
    title,
    primary_photo_id: primaryPhotoId,
  });
  return res.body.photoset.id;
}

async function uploadPhotoFromUrl(url, title, tags) {
  const image = await axios.get(url, { responseType: "arraybuffer" });
  const form = new FormData();
  form.append("title", title);
  form.append("tags", tags);
  form.append("photo", image.data, { filename: title });

  const headers = form.getHeaders();
  const uploadUrl = "https://up.flickr.com/services/upload/";

  const res = await axios.post(uploadUrl, form, {
    headers,
    auth: {
      username: process.env.FLICKR_API_KEY,
      password: process.env.FLICKR_API_SECRET,
    },
    params: {
      oauth_consumer_key: process.env.FLICKR_API_KEY,
      oauth_token: process.env.FLICKR_ACCESS_TOKEN,
    },
  });

  const parsed = new URLSearchParams(res.data);
  const photoId = parsed.get("photoid");
  if (!photoId) throw new Error("Upload failed");
  return photoId;
}

app.post("/upload", async (req, res) => {
  const { albumTitle, imageUrls, tags } = req.body;
  try {
    const uploadedIds = [];
    for (const imageUrl of imageUrls) {
      const title = path.basename(imageUrl);
      const id = await uploadPhotoFromUrl(imageUrl, title, tags);
      uploadedIds.push(id);
    }

    let albumId = await getAlbumIdByTitle(albumTitle);
    if (!albumId) {
      albumId = await createAlbum(albumTitle, uploadedIds[0]);
   
