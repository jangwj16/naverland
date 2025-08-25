export default async function handler(req, res) {
  const query = req.query.query;
  if (!query) {
    return res.status(400).json({ error: "Missing query" });
  }
  try {
    const response = await fetch(
      `https://naveropenapi.apigw.ntruss.com/map-geocode/v2/geocode?query=${encodeURIComponent(query)}`,
      {
        headers: {
          "X-NCP-APIGW-API-KEY-ID": process.env.NAVER_CLIENT_ID,
          "X-NCP-APIGW-API-KEY": process.env.NAVER_CLIENT_SECRET,
        },
      }
    );
    const data = await response.json();
    if (data.addresses && data.addresses.length > 0) {
      const lat = data.addresses[0].y;
      const lon = data.addresses[0].x;
      return res.status(200).json({ lat, lon, raw: data.addresses[0] });
    } else {
      return res.status(404).json({ error: "No result", query });
    }
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}