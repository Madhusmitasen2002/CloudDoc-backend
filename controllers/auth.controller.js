// server/controllers/auth.controller.js
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import supabase from "../supabase/supabaseClient.js";

// ===== Signup =====
export const signup = async (req, res) => {
  const { name = "", email, password } = req.body;

  try {
    if (!email || !password) {
      return res.status(400).json({ error: "Email & password required" });
    }

    // check existing user
    const { data: existing, error: existErr } = await supabase
      .from("users")
      .select("id")
      .eq("email", email)
      .maybeSingle();
    if (existErr) throw existErr;
    if (existing) return res.status(400).json({ error: "Email already registered" });

    const hashedPassword = await bcrypt.hash(password, 10);

    const { data, error } = await supabase
      .from("users")
      .insert([{ name, email, password: hashedPassword }])
      .select();
    if (error) throw error;

    return res.json({ message: "User created successfully", user: data[0] });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Signup failed" });
  }
};

// ===== Login =====
export const login = async (req, res) => {
  const { email, password } = req.body;

  try {
    const { data: user, error } = await supabase
      .from("users")
      .select("*")
      .eq("email", email)
      .single();

    if (error || !user) return res.status(401).json({ error: "Invalid email or password" });

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ error: "Invalid email or password" });

    // Sign with JWT_SECRET and put {id, email} so middleware can read it
    const token = jwt.sign(
      { id: user.id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: "1h" }
    );

    return res.json({ message: "Login successful", token });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Login failed" });
  }
};
