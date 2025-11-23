// /api/geocode.js
export default async function handler(req, res) {
  const { query } = req.query;

  const REST_API_KEY = "84cb2a6feb0a5da87adffd7daeb6efe4"; // 원종님 API 키

  const url = `https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(query)}`;

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `KakaoAK ${REST_API_KEY}`
      }
    });

    const data = await response.json();

    if (data.documents && data.documents.length > 0) {
      const { y: lat, x: lon } = data.documents[0];
      return res.status(200).json({ lat, lon });
    } else {
      return res.status(404).json({ error: "주소를 찾을 수 없습니다." });
    }
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
