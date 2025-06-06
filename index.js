const express = require("express");
const axios = require("axios");
const Flickr = require("flickr-sdk");
const FormData = require("form-data");

const app = express();
app.use(express.json());

const flickr = new Flickr(
  Flickr.OAuth.createPlugin(
    process.env.FLICKR_API_KEY,
    process.env.FLICKR_API_SECRET,
    process.env.FLICKR_OAUTH_TOKEN,
    process.env.FLICKR_OAUTH_TOKEN_SECRET
  )
);

app.post("/api/upload", async (req, res) => {
  const { dropboxUrl, title, tags, albumName } = req.body;

  try {
    const response = await axios({
      method: "GET",
      url: dropboxUrl,
      responseType: "stream",
    });

    const form = new FormData();
    form.append("photo", response.data, {
      filename: title || "upload.jpg",
      contentType: "image/jpeg",
    });
    form.append("title", title || "");
    form.append("tags", tags || "");

    const uploadRes = await axios.post(
      "https://up.flickr.com/services/upload/",
      form,
      {
        headers: form.getHeaders(),
        auth: {
          username: process.env.FLICKR_API_KEY,
          password: process.env.FLICKR_API_SECRET,
        },
      }
    );

    res.status(200).json({ message: "Upload successful" });
  } catch (error) {
    console.error("Upload failed:", error);
    res.status(500).json({ error: "Upload failed" });
  }
});

module.exports = app;
