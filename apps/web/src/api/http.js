import axios from "axios";

const http = axios.create({
  baseURL: "/",
  withCredentials: true,
  timeout: 95000,
  headers: {
    Accept: "application/json",
  },
});

http.interceptors.response.use(
  (resp) => resp,
  (error) => {
    if (error?.response?.status === 401 && typeof window !== "undefined") {
      const next = `${window.location.pathname}${window.location.search}`;
      window.location.href = `/login?next=${encodeURIComponent(next)}`;
      return Promise.reject(error);
    }
    return Promise.reject(error);
  }
);

export default http;
